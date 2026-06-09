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

    