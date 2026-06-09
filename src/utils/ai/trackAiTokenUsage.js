import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";
import { estimateAiCost } from "../billing/costEstimator.js";
import { deductWallet } from "../billing/walletGuard.js";
import {
  checkUsageLimit,
  invalidateUsageCache,
} from "../billing/usageLimiter.js";
import { recordHealthEvent } from "../billing/billingHealthMonitor.js";

/**
 * Logs AI token usage from an OpenAI API response and deducts from wallet.
 * Supports prepaid (wallet deduction) and postpaid (cycle tracking) modes.
 *
 * @param {string} tenant_id - Tenant identifier
 * @param {string} source - Origin of the call (whatsapp, playground, classifier, knowledge, language_detect)
 * @param {object} response - The full OpenAI response object (with usage property)
 */
export const trackAiTokenUsage = async (tenant_id, source, response) => {
  try {
    if (!response?.usage) return;

    const {
      prompt_tokens = 0,
      completion_tokens = 0,
      total_tokens = 0,
    } = response.usage;
    const rawModel = response.model || "gpt-4o-mini";

    // 1. Check usage limits
    const usageCheck = await checkUsageLimit(tenant_id, "ai_call");
    if (!usageCheck.allowed) {
      console.warn(
        `[AI-TOKEN-TRACKER] Usage limit hit for tenant ${tenant_id}: ${usageCheck.reason}`,
      );
      try {
        const io = getIO();
        io.to(`tenant-${tenant_id}`).emit("usage-limit-reached", {
          reason: usageCheck.reason,
          daily: usageCheck.daily,
          monthly: usageCheck.monthly,
        });
      } catch (_) {}

      // Still record usage (for tracking) but skip cost billing
      const costResult = await estimateAiCost(
        rawModel,
        prompt_tokens,
        completion_tokens,
      );
      const limitUsageRecord = await db.AiTokenUsage.create({
        tenant_id,
        model: costResult.model,
        source,
        prompt_tokens,
        completion_tokens,
        total_tokens,
        estimated_cost: Number(costResult.finalCostUsd.toFixed(8)),
        input_rate: costResult.pricingSnapshot.input_rate,
        output_rate: costResult.pricingSnapshot.output_rate,
        markup_percent: costResult.pricingSnapshot.markup_percent,
        usd_to_inr_rate: costResult.conversionRate,
        base_cost_usd: Number(costResult.baseCostUsd.toFixed(8)),
        final_cost_usd: Number(costResult.finalCostUsd.toFixed(8)),
        final_cost_inr: Number(costResult.finalCostInr.toFixed(6)),
        pricing_version: costResult.pricingVersion,
        billed: false,
      });
      // Create BillingLedger entry so it appears in Transaction Ledger
      await db.BillingLedger.create({
        tenant_id,
        entry_type: "ai",
        ai_token_usage_id: limitUsageRecord.id,
        category: "ai_usage",
        total_cost_inr: 0,
        markup_percent: costResult.pricingSnapshot.markup_percent,
        usd_to_inr_rate: costResult.conversionRate,
        conversion_rate_used: costResult.conversionRate,
        pricing_version: costResult.pricingVersion,
        billing_status: "insufficient_balance",
      });
      invalidateUsageCache(tenant_id);
      return;
    }

    // 2. Calculate cost using centralized cost estimator
    const costResult = await estimateAiCost(
      rawModel,
      prompt_tokens,
      completion_tokens,
    );
    const model = costResult.model;
    const pricingSnapshot = costResult.pricingSnapshot;
    const finalCostUsd = Number(costResult.finalCostUsd.toFixed(8));
    const finalCostInr = Number(costResult.finalCostInr.toFixed(6));
    const baseCostUsdRnd = Number(costResult.baseCostUsd.toFixed(8));
    const usdToInr = costResult.conversionRate;
    const appliedMarkup = costResult.markupPercent;
    const pricingVersion = costResult.pricingVersion;
    const estimatedCostInr = finalCostInr;

    console.log(
      `[AI-TOKEN-TRACKER] model=${rawModel} → normalized=${model} | ` +
        `input=${prompt_tokens} output=${completion_tokens} | ` +
        `input_rate=${pricingSnapshot.input_rate} output_rate=${pricingSnapshot.output_rate} | ` +
        `base_usd=${baseCostUsdRnd} markup=${appliedMarkup}% final_usd=${finalCostUsd} | ` +
        `usd_to_inr=${usdToInr} final_inr=${finalCostInr}`,
    );

    // 3. Fetch tenant billing mode
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["billing_mode", "postpaid_credit_limit"],
      raw: true,
    });
    const billing_mode = tenant?.billing_mode || "prepaid";

    // 4. Create AI token usage record + handle billing (atomic)
    await db.sequelize.transaction(async (t) => {
      const usageRecord = await db.AiTokenUsage.create(
        {
          tenant_id,
          model,
          source,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          estimated_cost: finalCostUsd,
          input_rate: pricingSnapshot.input_rate,
          output_rate: pricingSnapshot.output_rate,
          markup_percent: pricingSnapshot.markup_percent,
          usd_to_inr_rate: usdToInr,
          base_cost_usd: baseCostUsdRnd,
          final_cost_usd: finalCostUsd,
          final_cost_inr: finalCostInr,
          pricing_version: pricingVersion,
          billed: true,
        },
        { transaction: t },
      );

      if (estimatedCostInr <= 0) {
        // Zero-cost call — still create a ledger entry for visibility
        await db.BillingLedger.create(
          {
            tenant_id,
            entry_type: "ai",
            ai_token_usage_id: usageRecord.id,
            category: "ai_usage",
            total_cost_inr: 0,
            markup_percent: appliedMarkup,
            usd_to_inr_rate: usdToInr,
            conversion_rate_used: usdToInr,
            pricing_version: pricingVersion,
            billing_status: "free",
          },
          { transaction: t },
        );
      }

      if (estimatedCostInr > 0) {
        if (billing_mode === "prepaid") {
          // PREPAID: Deduct from wallet with FOR UPDATE lock — NO grace, NO negative
          let aiBillingStatus = "charged";
          let deductNewBalance = null;

          const deductResult = await deductWallet(
            tenant_id,
            estimatedCostInr,
            `ai_usage_${usageRecord.id}`,
            `AI Usage: ${model} (${source}) - ${total_tokens} tokens`,
            t,
          );

          if (!deductResult.success) {
            // Mark as unbilled — usage tracked but not charged
            await usageRecord.update({ billed: false }, { transaction: t });
            aiBillingStatus = "insufficient_balance";

            console.warn(
              `[AI-TOKEN-TRACKER] Prepaid deduction failed for tenant ${tenant_id}: ${deductResult.error}`,
            );

            try {
              const io = getIO();
              io.to(`tenant-${tenant_id}`).emit("insufficient-balance", {
                balance: deductResult.oldBalance,
                required: estimatedCostInr,
                shortfall:
                  deductResult.shortfall ||
                  estimatedCostInr - deductResult.oldBalance,
                message: "Insufficient balance for AI usage. Please recharge.",
              });
            } catch (_) {}
          } else {
            deductNewBalance = deductResult.newBalance;

            // Emit real-time update
            try {
              const io = getIO();
              io.to(`tenant-${tenant_id}`).emit("billing-update", {
                type: "AI_TOKEN_USAGE",
                tenant_id,
                model,
                source,
                totalTokens: total_tokens,
                costInr: estimatedCostInr,
                currentBalance: deductResult.newBalance,
                lowBalance: deductResult.newBalance < 100,
                timestamp: new Date(),
              });
            } catch (_) {}

            console.log(
              `[AI-TOKEN-TRACKER] PREPAID billed ${model} for tenant ${tenant_id}: ₹${estimatedCostInr.toFixed(6)} (${total_tokens} tokens). Balance: ₹${deductResult.newBalance.toFixed(4)}`,
            );
          }

          // Always create BillingLedger record (even on deduction failure)
          await db.BillingLedger.create(
            {
              tenant_id,
              entry_type: "ai",
              ai_token_usage_id: usageRecord.id,
              category: "ai_usage",
              total_cost_inr: estimatedCostInr,
              markup_percent: appliedMarkup,
              usd_to_inr_rate: usdToInr,
              conversion_rate_used: usdToInr,
              pricing_version: pricingVersion,
              billing_status: aiBillingStatus,
            },
            { transaction: t },
          );
        } else {
          // POSTPAID: No wallet deduction — update billing cycle totals
          let activeCycle = await db.BillingCycles.findOne({
            where: { tenant_id, status: "active" },
            lock: t.LOCK.UPDATE,
            transaction: t,
          });

          // Auto-create cycle if none exists (new postpaid tenant)
          if (!activeCycle) {
            const now = new Date();
            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + 30);
            activeCycle = await db.BillingCycles.create(
              {
                tenant_id,
                cycle_number: 1,
                start_date: now,
                end_date: endDate,
                status: "active",
                total_message_cost_inr: 0,
                total_ai_cost_inr: 0,
                total_cost_inr: 0,
                is_locked: false,
              },
              { transaction: t },
            );
            console.log(
              `[AI-TOKEN-TRACKER] Auto-created billing cycle for postpaid tenant ${tenant_id}`,
            );
          }

          if (!activeCycle) {
            console.error(
              `[AI-TOKEN-TRACKER] Failed to create billing cycle for tenant ${tenant_id}. Postpaid cost not tracked.`,
            );
            return usageRecord;
          }
          await activeCycle.increment(
            {
              total_ai_cost_inr: estimatedCostInr,
              total_cost_inr: estimatedCostInr,
            },
            { transaction: t },
          );

          // Link usage to billing cycle
          await usageRecord.update(
            { billing_cycle_id: activeCycle.id },
            { transaction: t },
          );

          // Create BillingLedger record for postpaid AI usage
          await db.BillingLedger.create(
            {
              tenant_id,
              entry_type: "ai",
              ai_token_usage_id: usageRecord.id,
              billing_cycle_id: activeCycle.id,
              category: "ai_usage",
              total_cost_inr: estimatedCostInr,
              markup_percent: appliedMarkup,
              usd_to_inr_rate: usdToInr,
              conversion_rate_used: usdToInr,
              pricing_version: pricingVersion,
              billing_status: "charged",
            },
            { transaction: t },
          );

          // Credit limit alerts
          const updatedTotal =
            parseFloat(activeCycle.total_cost_inr) + estimatedCostInr;
          const creditLimit = parseFloat(tenant?.postpaid_credit_limit) || 5000;

          try {
            const io = getIO();
            if (updatedTotal >= creditLimit) {
              io.to(`tenant-${tenant_id}`).emit("credit-limit-reached", {
                usage: updatedTotal,
                limit: creditLimit,
              });
            } else if (updatedTotal >= creditLimit * 0.8) {
              io.to(`tenant-${tenant_id}`).emit("credit-limit-warning", {
                usage: updatedTotal,
                limit: creditLimit,
                percent: Math.round((updatedTotal / creditLimit) * 100),
              });
            }

            io.to(`tenant-${tenant_id}`).emit("billing-update", {
              type: "AI_TOKEN_USAGE",
              tenant_id,
              model,
              source,
              totalTokens: total_tokens,
              costInr: estimatedCostInr,
              billing_mode: "postpaid",
              cycleUsage: updatedTotal,
              timestamp: new Date(),
            });
          } catch (_) {}

          console.log(
            `[AI-TOKEN-TRACKER] POSTPAID tracked ${model} for tenant ${tenant_id}: ₹${estimatedCostInr.toFixed(6)} (${total_tokens} tokens).`,
          );
        }
      }

      // Update daily + monthly usage summaries
      try {
        const today = new Date().toISOString().split("T")[0];
        const month = today.substring(0, 7);

        await db.DailyUsageSummary.findOrCreate({
          where: { tenant_id, summary_date: today },
          defaults: {
            tenant_id,
            summary_date: today,
            total_messages: 0,
            billable_messages: 0,
            message_cost_inr: 0,
            ai_calls: 0,
            ai_tokens_used: 0,
            ai_cost_inr: 0,
            total_cost_inr: 0,
          },
          transaction: t,
        });
        await db.DailyUsageSummary.increment(
          {
            ai_calls: 1,
            ai_tokens_used: total_tokens,
            ai_cost_inr: estimatedCostInr,
            total_cost_inr: estimatedCostInr,
          },
          { where: { tenant_id, summary_date: today }, transaction: t },
        );

        await db.MonthlyUsageSummary.findOrCreate({
          where: { tenant_id, summary_month: month },
          defaults: {
            tenant_id,
            summary_month: month,
            total_messages: 0,
            billable_messages: 0,
            message_cost_inr: 0,
            ai_calls: 0,
            ai_tokens_used: 0,
            ai_cost_inr: 0,
            total_cost_inr: 0,
          },
          transaction: t,
        });
        await db.MonthlyUsageSummary.increment(
          {
            ai_calls: 1,
            ai_tokens_used: total_tokens,
            ai_cost_inr: estimatedCostInr,
            total_cost_inr: estimatedCostInr,
          },
          { where: { tenant_id, summary_month: month }, transaction: t },
        );
      } catch (summaryErr) {
        console.error(
          "[AI-TOKEN-TRACKER] Summary update error:",
          summaryErr.message,
        );
      }
    });

    // Invalidate usage cache
    invalidateUsageCache(tenant_id);
  } catch (err) {
    console.error("[AI-TOKEN-TRACKER] Failed to log token usage:", err.message);
    await recordHealthEvent(
      "billing_failure",
      tenant_id,
      `AI token tracking failed: ${err.message}`,
      {
        model: response?.model,
        stack: err.stack,
      },
    );
  }
};
