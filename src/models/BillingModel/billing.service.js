import db from "../../database/index.js";
import { Op } from "sequelize";
import cron from "node-cron";
import axios from "axios";
import libphonenumber from "google-libphonenumber";
import { getIO } from "../../middlewares/socket/socket.js";
import { tableNames } from "../../database/tableName.js";
import { DEFAULT_USD_TO_INR } from "../../config/billing.config.js";
import { estimateMetaCost } from "../../utils/billing/costEstimator.js";
import { deductWallet } from "../../utils/billing/walletGuard.js";
import {
  checkUsageLimit,
  invalidateUsageCache,
} from "../../utils/billing/usageLimiter.js";
import { recordHealthEvent } from "../../utils/billing/billingHealthMonitor.js";

const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();

/**
 * Processes Meta Webhook status updates to calculate billing.
 * Meta includes pricing and conversation models in "sent" or "delivered" statuses.
 */
export const processBillingFromWebhook = async (tenant_id, statusUpdate) => {
  try {
    const { id: message_id, status, pricing, conversation } = statusUpdate;

    // Skip all billing if the tenant's WhatsApp account has a token error.
    // A broken token means no new messages are being sent, so billing should stop.
    try {
      const [acctRows] = await db.sequelize.query(
        `SELECT status FROM ${tableNames.WHATSAPP_ACCOUNT} WHERE tenant_id = ? AND is_deleted = false LIMIT 1`,
        { replacements: [tenant_id] },
      );
      if (acctRows[0]?.status === "token_error") {
        console.log(
          `[BILLING] Skipping Meta billing for tenant ${tenant_id} — account has token_error status`,
        );
        return;
      }
    } catch (checkErr) {
      console.error("[BILLING] Token status check failed:", checkErr.message);
    }

    // We only create entries when Meta provides the pricing object on the "sent" status of a new conversation window.
    if (!pricing) {
      return;
    }

    // Meta sends categories in UPPERCASE (e.g., "MARKETING"), normalize to lowercase for our ENUM
    const rawCategory =
      pricing.category || conversation?.origin?.type || "service";
    const category = rawCategory.toLowerCase();
    const billable = pricing.billable;
    const conversation_id = conversation?.id || null;

    // 1. Create MessageUsage Record (Tracks BOTH billable and free conversations)
    // Use findOrCreate to handle race conditions where multiple webhooks arrive simultaneously
    const [usageRecord, created] = await db.MessageUsage.findOrCreate({
      where: { message_id },
      defaults: {
        tenant_id,
        message_id,
        conversation_id,
        category,
        billable,
        status, // 'sent'
        timestamp: new Date(),
      },
    });

    // If record already existed, just update status if changed
    if (!created) {
      if (usageRecord.status !== status) {
        await usageRecord.update({ status });
        // Emit socket event so frontend ledger table updates live
        try {
          const io = getIO();
          io.to(`tenant-${tenant_id}`).emit("billing-update", {
            type: "STATUS_UPDATE",
            tenant_id,
            message_id,
            status,
            timestamp: new Date().toISOString(),
          });
        } catch (_) {}
      }
      return;
    }

    // 2. Detect country from recipient phone number
    const recipient_id = statusUpdate.recipient_id;
    let country = "Global";

    if (recipient_id) {
      try {
        const phoneStr = recipient_id.startsWith("+")
          ? recipient_id
          : `+${recipient_id}`;
        const number = phoneUtil.parseAndKeepRawInput(phoneStr);
        const regionCode = phoneUtil.getRegionCodeForNumber(number);
        if (regionCode) {
          country = regionCode;
        }
      } catch (phoneErr) {
        console.warn(
          `[BILLING] Failed to parse recipient_id ${recipient_id} for country detection:`,
          phoneErr.message,
        );
        if (recipient_id.startsWith("91")) country = "IN";
        else if (recipient_id.startsWith("44")) country = "GB";
        else if (recipient_id.startsWith("1")) country = "US";
      }
    }

    if (country === "Global") {
      const tenantRecord = await db.Tenants.findOne({ where: { tenant_id } });
      if (tenantRecord && tenantRecord.country) {
        country = tenantRecord.country;
      }
    }

    // 3. Calculate Cost using centralized cost estimator
    const costResult = await estimateMetaCost(category, country);
    const baseRate = costResult.baseRate;
    const markupPercent = costResult.markupPercent;
    const platformFee = costResult.platformFee;
    const totalCostUsd = costResult.totalCostUsd;
    const totalCostInr = costResult.totalCostInr;
    const usdToInrRate = costResult.conversionRate;
    const pricingVersion = costResult.pricingVersion;

    let template_name = null;
    let campaign_name = null;

    try {
      // 1. Fetch message template name directly from the Messages table
      const messageData = await db.Messages.findOne({
        where: { wamid: message_id },
        attributes: ["template_name"],
      });

      if (messageData?.template_name) {
        template_name = messageData.template_name;
      }

      // 2. Fetch Campaign Metadata if applicable
      const [campaignRecipients] = await db.sequelize.query(
        `SELECT c.campaign_name, t.template_name 
         FROM whatsapp_campaign_recipients r
         JOIN whatsapp_campaigns c ON r.campaign_id = c.campaign_id
         JOIN whatsapp_templates t ON c.template_id = t.template_id
         WHERE r.meta_message_id = ? LIMIT 1`,
        { replacements: [message_id] },
      );

      if (campaignRecipients.length > 0) {
        campaign_name = campaignRecipients[0].campaign_name;
        // Only override if not already set by Messages table
        if (!template_name) {
          template_name = campaignRecipients[0].template_name;
        }
      }
    } catch (err) {
      console.error("[BILLING] Error fetching message/campaign metadata:", err);
    }

    // 4. Fetch tenant billing mode
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["billing_mode", "postpaid_credit_limit"],
      raw: true,
    });
    const billing_mode = tenant?.billing_mode || "prepaid";

    // 5. Check usage limits before billing
    const usageCheck = await checkUsageLimit(tenant_id, "message");
    if (!usageCheck.allowed) {
      console.warn(
        `[BILLING] Usage limit hit for tenant ${tenant_id}: ${usageCheck.reason}`,
      );
      try {
        const io = getIO();
        io.to(`tenant-${tenant_id}`).emit("usage-limit-reached", {
          reason: usageCheck.reason,
          daily: usageCheck.daily,
          monthly: usageCheck.monthly,
        });
      } catch (_) {}
      // Still track usage but skip billing
    }

    // 6. Create BillingLedger Record (both modes — for reporting)
    await db.sequelize.transaction(async (t) => {
      // Check for duplicate billing first
      const existingLedger = await db.BillingLedger.findOne({
        where: { message_usage_id: usageRecord.id },
        transaction: t,
      });
      if (existingLedger) {
        console.log(
          `[BILLING] Skipping duplicate billing for message_usage_id ${usageRecord.id}`,
        );
        return;
      }

      if (totalCostInr > 0 && billing_mode === "prepaid") {
        // PREPAID: Deduct from wallet FIRST, then create ledger
        const deductResult = await deductWallet(
          tenant_id,
          totalCostInr,
          `msg_${usageRecord.id}`,
          `Message Billing: ${category} (${country}) [$${totalCostUsd.toFixed(4)} × ₹${usdToInrRate}]`,
          t,
        );

        if (!deductResult.success) {
          console.warn(
            `[BILLING] Prepaid deduction failed for tenant ${tenant_id}: ${deductResult.error}`,
          );
          try {
            const io = getIO();
            io.to(`tenant-${tenant_id}`).emit("insufficient-balance", {
              balance: deductResult.oldBalance,
              required: totalCostInr,
              shortfall:
                deductResult.shortfall ||
                totalCostInr - deductResult.oldBalance,
            });
          } catch (_) {}
          // Deduction failed — do NOT create ledger entry
          return;
        }
      }

      // Create ledger AFTER successful deduction (prepaid) or directly (postpaid)
      const ledger = await db.BillingLedger.create(
        {
          tenant_id,
          entry_type: "message",
          message_usage_id: usageRecord.id,
          template_name: template_name,
          campaign_name: campaign_name,
          category: category,
          country: country,
          rate: baseRate,
          meta_cost: baseRate,
          platform_fee: platformFee,
          total_cost: totalCostUsd,
          markup_percent: markupPercent,
          usd_to_inr_rate: usdToInrRate,
          total_cost_inr: totalCostInr,
          conversion_rate_used: usdToInrRate,
          pricing_version: pricingVersion,
        },
        { transaction: t },
      );

      if (totalCostInr > 0 && billing_mode !== "prepaid") {
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
            `[BILLING] Auto-created billing cycle for postpaid tenant ${tenant_id}`,
          );
        }

        if (activeCycle) {
          await activeCycle.increment(
            {
              total_message_cost_inr: totalCostInr,
              total_cost_inr: totalCostInr,
            },
            { transaction: t },
          );

          // Link ledger to billing cycle
          await ledger.update(
            { billing_cycle_id: activeCycle.id },
            { transaction: t },
          );

          // Check credit limit thresholds
          const updatedTotal =
            parseFloat(activeCycle.total_cost_inr) + totalCostInr;
          const creditLimit = parseFloat(tenant?.postpaid_credit_limit) || 5000;

          if (updatedTotal >= creditLimit) {
            try {
              const io = getIO();
              io.to(`tenant-${tenant_id}`).emit("credit-limit-reached", {
                usage: updatedTotal,
                limit: creditLimit,
              });
            } catch (_) {}
          } else if (updatedTotal >= creditLimit * 0.8) {
            try {
              const io = getIO();
              io.to(`tenant-${tenant_id}`).emit("credit-limit-warning", {
                usage: updatedTotal,
                limit: creditLimit,
                percent: Math.round((updatedTotal / creditLimit) * 100),
              });
            } catch (_) {}
          }
        }
      }

      // Update daily + monthly usage summaries (both modes)
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
            total_messages: 1,
            billable_messages: billable ? 1 : 0,
            message_cost_inr: totalCostInr,
            total_cost_inr: totalCostInr,
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
            total_messages: 1,
            billable_messages: billable ? 1 : 0,
            message_cost_inr: totalCostInr,
            total_cost_inr: totalCostInr,
          },
          { where: { tenant_id, summary_month: month }, transaction: t },
        );
      } catch (summaryErr) {
        console.error("[BILLING] Summary update error:", summaryErr.message);
      }
    });

    // Invalidate usage cache
    invalidateUsageCache(tenant_id);

    // 7. Emit real-time update via Socket
    let currentBalance = 0;
    let wallet = null;
    try {
      wallet = await db.Wallets.findOne({ where: { tenant_id } });
      if (wallet) currentBalance = parseFloat(wallet.balance);
    } catch (e) {}

    console.log(
      `[BILLING] ${billing_mode.toUpperCase()} billed ${category} for tenant ${tenant_id}: ₹${totalCostInr.toFixed(4)} ($${totalCostUsd.toFixed(4)} × ${usdToInrRate}). Balance: ₹${currentBalance.toFixed(4)}`,
    );

    try {
      const io = getIO();
      const payload = {
        type: "NEW_LEDGER_ENTRY",
        tenant_id,
        category,
        totalCost: totalCostInr,
        currentBalance,
        billing_mode,
        lowBalance: billing_mode === "prepaid" && currentBalance < 100,
        timestamp: new Date(),
      };
      io.to(`tenant-${tenant_id}`).emit("billing-update", payload);

      // Prepaid-specific alerts
      if (billing_mode === "prepaid" && currentBalance < 100) {
        io.to(`tenant-${tenant_id}`).emit("low-balance-warning", {
          balance: currentBalance,
          message:
            currentBalance <= 0
              ? "Wallet balance is zero. Recharge immediately to continue messaging."
              : `Wallet balance is low (₹${currentBalance.toFixed(2)}). Please recharge soon.`,
        });
      }

      // Auto-recharge trigger
      if (
        billing_mode === "prepaid" &&
        wallet &&
        wallet.auto_recharge_enabled &&
        currentBalance < parseFloat(wallet.auto_recharge_threshold)
      ) {
        const rechargeAmount = parseFloat(wallet.auto_recharge_amount);
        console.log(
          `[AUTO-RECHARGE] Balance ₹${currentBalance.toFixed(2)} below threshold. Triggering auto-recharge of ₹${rechargeAmount.toFixed(2)} for tenant ${tenant_id}`,
        );
        io.to(`tenant-${tenant_id}`).emit("auto-recharge-trigger", {
          balance: currentBalance,
          threshold: parseFloat(wallet.auto_recharge_threshold),
          amount: rechargeAmount,
          message: `Auto-recharge triggered: Balance ₹${currentBalance.toFixed(2)} below threshold.`,
        });
      }
    } catch (socketErr) {
      console.error(
        "[BILLING SOCKET ERROR] Failed to emit billing update:",
        socketErr.message,
      );
    }
  } catch (error) {
    console.error(
      `[BILLING ERROR] processing message ${statusUpdate?.id}:`,
      error,
    );
    await recordHealthEvent("billing_failure", tenant_id, error.message, {
      message_id: statusUpdate?.id,
      stack: error.stack,
    });
  }
};

/**
 * Fetches the high-level Billing KPIs for a tenant.
 */
export const getBillingKpiService = async (tenant_id, startDate, endDate) => {
  try {
    const whereClause = { tenant_id };

    if (startDate && endDate) {
      whereClause.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    // 1. Calculate category-wise spent using aggregation (INR — actual wallet deductions)
    const categoryTotals = await db.BillingLedger.findAll({
      attributes: [
        "category",
        [
          db.sequelize.fn("SUM", db.sequelize.col("total_cost_inr")),
          "totalSpentInr",
        ],
        [
          db.sequelize.fn("SUM", db.sequelize.col("total_cost")),
          "totalSpentUsd",
        ],
      ],
      where: whereClause,
      group: ["category"],
    });

    let totalSpentInr = 0;
    let totalSpentUsd = 0;
    let marketingSpent = 0;
    let utilitySpent = 0;
    let authSpent = 0;
    let serviceSpent = 0;

    categoryTotals.forEach((result) => {
      const category = result.category;
      const totalInr = parseFloat(result.get("totalSpentInr")) || 0;
      const totalUsd = parseFloat(result.get("totalSpentUsd")) || 0;
      totalSpentInr += totalInr;
      totalSpentUsd += totalUsd;
      if (category === "marketing") marketingSpent = totalInr;
      else if (category === "utility") utilitySpent = totalInr;
      else if (category === "authentication") authSpent = totalInr;
      else if (category === "service") serviceSpent = totalInr;
    });

    // 2. Count messages and conversations using aggregation
    // Note: MessageUsage uses 'timestamp' for the actual event time
    const usageWhere = { tenant_id };
    if (startDate && endDate) {
      usageWhere.timestamp = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const totalMessagesSent = await db.MessageUsage.count({
      where: usageWhere,
    });

    const billableConversations = await db.MessageUsage.count({
      where: { ...usageWhere, billable: true },
    });

    const freeConversations = await db.MessageUsage.count({
      where: { ...usageWhere, billable: false },
    });

    // 3. Fetch Wallet Balance (Upsert default if missing)
    let [wallet] = await db.Wallets.findOrCreate({
      where: { tenant_id },
      defaults: { tenant_id, balance: 0, currency: "INR" },
    });

    return {
      totalSpentEstimated: totalSpentInr,
      totalSpentUsd,
      marketingSpent,
      utilitySpent,
      authSpent,
      serviceSpent,
      totalMessagesSent,
      billableConversations,
      freeConversations,
      walletBalance: parseFloat(wallet.balance) || 0,
      currency: wallet.currency || "INR",
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches paginated billing ledger history for a tenant.
 */
export const getBillingLedgerService = async (
  tenant_id,
  page = 1,
  limit = 50,
  category,
  startDate,
  endDate,
) => {
  try {
    const offset = (page - 1) * limit;

    const whereClause = { tenant_id };
    if (category && category !== "All") {
      whereClause.category = category.toLowerCase();
    }

    if (startDate && endDate) {
      whereClause.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const { count, rows } = await db.BillingLedger.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
      include: [
        {
          model: db.MessageUsage,
          as: "messageUsage",
          attributes: ["status", "conversation_id"],
          include: [
            {
              model: db.Messages,
              as: "messageDetails",
              attributes: ["phone", "name"],
            },
          ],
        },
      ],
    });

    const records = rows.map((ledger) => ({
      id: ledger.id,
      date: ledger.createdAt,
      category: ledger.category,
      template: ledger.template_name || "—",
      campaign: ledger.campaign_name || "—",
      messages: 1,
      recipient: ledger.messageUsage?.messageDetails?.phone || "—",
      recipientName: ledger.messageUsage?.messageDetails?.name || null,
      country: ledger.country,
      rate: ledger.rate,
      metaCost: ledger.meta_cost,
      platformFee: ledger.platform_fee,
      markupPercent: ledger.markup_percent,
      total: ledger.total_cost,
      usdToInrRate: ledger.usd_to_inr_rate || DEFAULT_USD_TO_INR,
      totalInr:
        ledger.total_cost_inr ||
        parseFloat(ledger.total_cost) *
          (parseFloat(ledger.usd_to_inr_rate) || DEFAULT_USD_TO_INR),
      status: ledger.messageUsage?.status || "Unknown",
    }));

    return {
      records,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches time-series spend chart data for a tenant.
 */
export const getBillingSpendChartService = async (
  tenant_id,
  startDate,
  endDate,
) => {
  try {
    const whereClause = { tenant_id };
    if (startDate && endDate) {
      whereClause.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const ledgers = await db.BillingLedger.findAll({
      where: whereClause,
      order: [["created_at", "ASC"]],
    });

    const spendMap = {};

    ledgers.forEach((l) => {
      const dateKey = new Date(l.createdAt).toISOString().split("T")[0];
      if (!spendMap[dateKey]) {
        spendMap[dateKey] = {
          date: dateKey,
          marketing: 0,
          utility: 0,
          auth: 0,
        };
      }
      const cost = parseFloat(l.total_cost_inr) || 0;
      if (l.category === "marketing") spendMap[dateKey].marketing += cost;
      else if (l.category === "utility") spendMap[dateKey].utility += cost;
      else if (l.category === "authentication") spendMap[dateKey].auth += cost;
      else if (l.category === "service")
        spendMap[dateKey].service = (spendMap[dateKey].service || 0) + cost;
    });

    return Object.values(spendMap);
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches the current wallet balance for a tenant.
 */
export const getWalletBalanceService = async (tenant_id) => {
  try {
    const [wallet] = await db.Wallets.findOrCreate({
      where: { tenant_id },
      defaults: { tenant_id, balance: 0, currency: "INR" },
    });
    const balance = parseFloat(wallet.balance) || 0;

    // Fetch billing mode info
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: [
        "billing_mode",
        "postpaid_credit_limit",
        "billing_cycle_start",
        "billing_cycle_end",
      ],
      raw: true,
    });
    const billing_mode = tenant?.billing_mode || "prepaid";

    const result = {
      balance,
      currency: wallet.currency || "INR",
      lowBalance: balance < 100,
      balanceStatus:
        balance <= 0 ? "critical" : balance < 100 ? "low" : "healthy",
      billing_mode,
      autoRecharge: {
        enabled: wallet.auto_recharge_enabled || false,
        threshold: parseFloat(wallet.auto_recharge_threshold) || 100,
        amount: parseFloat(wallet.auto_recharge_amount) || 500,
      },
    };

    // Add postpaid-specific info
    if (billing_mode === "postpaid") {
      const activeCycle = await db.BillingCycles.findOne({
        where: { tenant_id, status: "active" },
        raw: true,
      });
      const creditLimit = parseFloat(tenant?.postpaid_credit_limit) || 5000;
      const currentCycleUsage = activeCycle
        ? parseFloat(activeCycle.total_cost_inr) || 0
        : 0;

      result.postpaid = {
        currentCycleUsage,
        creditLimit,
        creditUsagePercent:
          creditLimit > 0
            ? Math.round((currentCycleUsage / creditLimit) * 100)
            : 0,
        nextInvoiceDate: tenant?.billing_cycle_end || null,
      };
    }

    return result;
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches the wallet transaction history for a tenant.
 */
export const getWalletTransactionsService = async (
  tenant_id,
  page = 1,
  limit = 10,
  startDate = null,
  endDate = null,
) => {
  try {
    const offset = (page - 1) * limit;
    const whereClause = { tenant_id };

    if (startDate && endDate) {
      whereClause.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const { count, rows } = await db.WalletTransactions.findAndCountAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      limit,
      offset,
    });

    return {
      transactions: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit),
      },
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches all pricing table entries (SuperAdmin only).
 */
export const getPricingTableService = async () => {
  try {
    return await db.PricingTable.findAll({
      order: [
        ["country", "ASC"],
        ["category", "ASC"],
      ],
    });
  } catch (error) {
    throw error;
  }
};

/**
 * Updates a pricing table entry (SuperAdmin only).
 */
export const updatePricingService = async (id, updateData) => {
  try {
    const pricing = await db.PricingTable.findByPk(id);
    if (!pricing) throw new Error("Pricing entry not found");

    return await pricing.update(updateData);
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches top templates by spend for a tenant.
 */
export const getBillingTemplateStatsService = async (
  tenant_id,
  startDate,
  endDate,
) => {
  try {
    const whereClause = { tenant_id, template_name: { [Op.ne]: null } };
    if (startDate && endDate) {
      whereClause.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const stats = await db.BillingLedger.findAll({
      attributes: [
        "template_name",
        "category",
        [
          db.sequelize.fn("SUM", db.sequelize.col("total_cost_inr")),
          "totalCost",
        ],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "messageCount"],
        [db.sequelize.fn("AVG", db.sequelize.col("total_cost_inr")), "avgRate"],
      ],
      where: whereClause,
      group: ["template_name", "category"],
      order: [[db.sequelize.literal("totalCost"), "DESC"]],
      limit: 10,
    });

    return stats.map((s) => ({
      name: s.template_name,
      category: s.category,
      sent: parseInt(s.get("messageCount")),
      cost: parseFloat(s.get("totalCost")),
      costPerMsg: parseFloat(s.get("avgRate")).toFixed(4),
    }));
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches top campaigns by spend for a tenant.
 */
export const getBillingCampaignStatsService = async (
  tenant_id,
  startDate,
  endDate,
) => {
  try {
    const whereClause = { tenant_id, campaign_name: { [Op.ne]: null } };
    if (startDate && endDate) {
      whereClause.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const stats = await db.BillingLedger.findAll({
      attributes: [
        "campaign_name",
        "template_name",
        [
          db.sequelize.fn("SUM", db.sequelize.col("total_cost_inr")),
          "totalCost",
        ],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "recipientCount"],
        [
          db.sequelize.fn("AVG", db.sequelize.col("total_cost_inr")),
          "avgRatePerRecipient",
        ],
      ],
      where: whereClause,
      group: ["campaign_name", "template_name"],
      order: [[db.sequelize.literal("totalCost"), "DESC"]],
      limit: 10,
    });

    // Calculate real delivery rates from MessageUsage
    const results = [];
    for (const s of stats) {
      const campaignName = s.campaign_name;
      let deliveryRate = "0%";

      try {
        const [deliveryData] = await db.sequelize.query(
          `SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN mu.status IN ('delivered', 'read') THEN 1 ELSE 0 END) as delivered
          FROM billing_ledger bl
          JOIN message_usage mu ON bl.message_usage_id = mu.id
          WHERE bl.tenant_id = ? AND bl.campaign_name = ?`,
          { replacements: [tenant_id, campaignName] },
        );
        if (deliveryData[0]?.total > 0) {
          const rate = (
            (deliveryData[0].delivered / deliveryData[0].total) *
            100
          ).toFixed(1);
          deliveryRate = `${rate}%`;
        }
      } catch (e) {
        console.warn(
          `[BILLING] Failed to calculate delivery rate for campaign ${campaignName}:`,
          e.message,
        );
      }

      results.push({
        name: campaignName,
        template: s.template_name,
        recipients: parseInt(s.get("recipientCount")),
        cost: parseFloat(s.get("totalCost")),
        costPerRecipient: parseFloat(s.get("avgRatePerRecipient")).toFixed(4),
        deliveryRate,
      });
    }

    return results;
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches AI API token usage statistics for a tenant.
 */
export const getAiTokenUsageService = async (tenant_id, startDate, endDate) => {
  try {
    const whereClause = { tenant_id };
    if (startDate && endDate) {
      whereClause.created_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    // 1. Aggregate totals
    const totals = await db.AiTokenUsage.findOne({
      attributes: [
        [
          db.sequelize.fn("SUM", db.sequelize.col("prompt_tokens")),
          "totalPromptTokens",
        ],
        [
          db.sequelize.fn("SUM", db.sequelize.col("completion_tokens")),
          "totalCompletionTokens",
        ],
        [
          db.sequelize.fn("SUM", db.sequelize.col("total_tokens")),
          "totalTokens",
        ],
        [
          db.sequelize.fn("SUM", db.sequelize.col("estimated_cost")),
          "totalCostUsd",
        ],
        [
          db.sequelize.fn("SUM", db.sequelize.col("base_cost_usd")),
          "totalBaseCostUsd",
        ],
        // Use stored final_cost_inr — no frontend recalculation needed
        [
          db.sequelize.fn("SUM", db.sequelize.col("final_cost_inr")),
          "totalCostInr",
        ],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "totalCalls"],
      ],
      where: whereClause,
      raw: true,
    });

    // 2. Breakdown by model
    const byModel = await db.AiTokenUsage.findAll({
      attributes: [
        "model",
        [
          db.sequelize.fn("SUM", db.sequelize.col("prompt_tokens")),
          "promptTokens",
        ],
        [
          db.sequelize.fn("SUM", db.sequelize.col("completion_tokens")),
          "completionTokens",
        ],
        [
          db.sequelize.fn("SUM", db.sequelize.col("total_tokens")),
          "totalTokens",
        ],
        [db.sequelize.fn("SUM", db.sequelize.col("estimated_cost")), "costUsd"],
        [db.sequelize.fn("SUM", db.sequelize.col("final_cost_inr")), "costInr"],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "calls"],
      ],
      where: whereClause,
      group: ["model"],
      raw: true,
    });

    // 3. Breakdown by source
    const bySource = await db.AiTokenUsage.findAll({
      attributes: [
        "source",
        [
          db.sequelize.fn("SUM", db.sequelize.col("total_tokens")),
          "totalTokens",
        ],
        [db.sequelize.fn("SUM", db.sequelize.col("estimated_cost")), "costUsd"],
        [db.sequelize.fn("SUM", db.sequelize.col("final_cost_inr")), "costInr"],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "calls"],
      ],
      where: whereClause,
      group: ["source"],
      raw: true,
    });

    // 4. Daily time series
    const daily = await db.AiTokenUsage.findAll({
      attributes: [
        [db.sequelize.fn("DATE", db.sequelize.col("created_at")), "date"],
        [
          db.sequelize.fn("SUM", db.sequelize.col("total_tokens")),
          "totalTokens",
        ],
        [db.sequelize.fn("SUM", db.sequelize.col("estimated_cost")), "costUsd"],
        [db.sequelize.fn("SUM", db.sequelize.col("final_cost_inr")), "costInr"],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "calls"],
      ],
      where: whereClause,
      group: [db.sequelize.fn("DATE", db.sequelize.col("created_at"))],
      order: [[db.sequelize.fn("DATE", db.sequelize.col("created_at")), "ASC"]],
      raw: true,
    });

    // 5. Recent calls (last 20)
    const recentCalls = await db.AiTokenUsage.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      limit: 20,
      raw: true,
    });

    // Convert USD to INR — use DB rate if available, else fallback
    let usdToInr = DEFAULT_USD_TO_INR;
    try {
      const aiPricingRule = await db.AiPricing.findOne({
        where: { is_active: true },
        attributes: ["usd_to_inr_rate"],
        raw: true,
      });
      if (aiPricingRule?.usd_to_inr_rate) {
        usdToInr = parseFloat(aiPricingRule.usd_to_inr_rate);
      }
    } catch (_) {}
    const totalCostUsd = parseFloat(totals?.totalCostUsd) || 0;
    const totalCostInr = parseFloat(totals?.totalCostInr) || 0;
    const totalBaseCostUsd = parseFloat(totals?.totalBaseCostUsd) || 0;
    const totalPlatformFeeUsd = totalCostUsd - totalBaseCostUsd;

    return {
      summary: {
        totalPromptTokens: parseInt(totals?.totalPromptTokens) || 0,
        totalCompletionTokens: parseInt(totals?.totalCompletionTokens) || 0,
        totalTokens: parseInt(totals?.totalTokens) || 0,
        totalCostUsd,
        totalBaseCostUsd,
        totalPlatformFeeUsd,
        totalCostInr, // Authoritative — summed from stored final_cost_inr
        totalCalls: parseInt(totals?.totalCalls) || 0,
        usdToInrRate: usdToInr,
      },
      byModel: byModel.map((m) => ({
        model: m.model,
        promptTokens: parseInt(m.promptTokens) || 0,
        completionTokens: parseInt(m.completionTokens) || 0,
        totalTokens: parseInt(m.totalTokens) || 0,
        costUsd: parseFloat(m.costUsd) || 0,
        costInr: parseFloat(m.costInr) || 0,
        calls: parseInt(m.calls) || 0,
      })),
      bySource: bySource.map((s) => ({
        source: s.source,
        totalTokens: parseInt(s.totalTokens) || 0,
        costUsd: parseFloat(s.costUsd) || 0,
        costInr: parseFloat(s.costInr) || 0,
        calls: parseInt(s.calls) || 0,
      })),
      daily: daily.map((d) => ({
        date: d.date,
        totalTokens: parseInt(d.totalTokens) || 0,
        costUsd: parseFloat(d.costUsd) || 0,
        costInr: parseFloat(d.costInr) || 0,
        calls: parseInt(d.calls) || 0,
      })),
      recentCalls,
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches the auto-recharge settings for a tenant's wallet.
 */
export const getAutoRechargeSettingsService = async (tenant_id) => {
  try {
    const [wallet] = await db.Wallets.findOrCreate({
      where: { tenant_id },
      defaults: { tenant_id, balance: 0, currency: "INR" },
    });
    return {
      enabled: wallet.auto_recharge_enabled || false,
      threshold: parseFloat(wallet.auto_recharge_threshold) || 100,
      amount: parseFloat(wallet.auto_recharge_amount) || 500,
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Updates the auto-recharge settings for a tenant's wallet.
 */
export const updateAutoRechargeSettingsService = async (
  tenant_id,
  settings,
) => {
  try {
    const { enabled, threshold, amount } = settings;

    const [wallet] = await db.Wallets.findOrCreate({
      where: { tenant_id },
      defaults: { tenant_id, balance: 0, currency: "INR" },
    });

    const updateData = {};
    if (typeof enabled === "boolean")
      updateData.auto_recharge_enabled = enabled;
    if (threshold !== undefined && threshold !== null) {
      const t = parseFloat(threshold);
      if (isNaN(t) || t < 0) throw new Error("Invalid threshold value");
      updateData.auto_recharge_threshold = t;
    }
    if (amount !== undefined && amount !== null) {
      const a = parseFloat(amount);
      if (isNaN(a) || a < 100)
        throw new Error("Minimum auto-recharge amount is ₹100");
      updateData.auto_recharge_amount = a;
    }

    // Validate that recharge amount is greater than threshold to prevent ineffective auto-recharge
    const finalThreshold =
      updateData.auto_recharge_threshold ??
      (parseFloat(wallet.auto_recharge_threshold) || 100);
    const finalAmount =
      updateData.auto_recharge_amount ??
      (parseFloat(wallet.auto_recharge_amount) || 500);
    if (finalAmount <= finalThreshold) {
      throw new Error("Auto-recharge amount must be greater than threshold");
    }

    await wallet.update(updateData);

    return {
      enabled: wallet.auto_recharge_enabled,
      threshold: parseFloat(wallet.auto_recharge_threshold),
      amount: parseFloat(wallet.auto_recharge_amount),
    };
  } catch (error) {
    throw error;
  }
};

export const getAvailableAiModelsService = async () => {
  const models = await db.AiPricing.findAll({
    where: { is_active: true },
    attributes: [
      "id",
      "model",
      "description",
      "recommended_for",
      "category",
      "input_rate",
      "output_rate",
      "usd_to_inr_rate",
    ],
    order: [
      ["category", "ASC"],
      ["input_rate", "ASC"],
    ],
    raw: true,
  });

  return models.map((m) => {
    const usdToInr = parseFloat(m.usd_to_inr_rate) || DEFAULT_USD_TO_INR;
    const inputUsd = parseFloat(m.input_rate);
    const outputUsd = parseFloat(m.output_rate);
    return {
      ...m,
      input_rate: inputUsd,
      output_rate: outputUsd,
      input_rate_inr: inputUsd * usdToInr,
      output_rate_inr: outputUsd * usdToInr,
      usd_to_inr_rate: usdToInr,
    };
  });
};

/**
 * Super Admin: Add manual credit to a tenant's wallet
 * Used for bank transfers, refunds, or promotional credits
 */
export const addManualCreditService = async (
  tenant_id,
  amount,
  reason,
  reference_id,
  admin_id,
) => {
  try {
    if (!amount || amount <= 0) {
      throw new Error("Amount must be positive");
    }
    if (!reason) {
      throw new Error("Reason is required");
    }

    const amountInRupees = parseFloat(amount);

    let newBalance = 0;
    await db.sequelize.transaction(async (t) => {
      // Find or create wallet
      let [wallet] = await db.Wallets.findOrCreate({
        where: { tenant_id },
        defaults: { tenant_id, balance: 0, currency: "INR" },
        transaction: t,
      });

      newBalance = parseFloat(wallet.balance) + amountInRupees;
      await wallet.update({ balance: newBalance }, { transaction: t });

      // Log the transaction with admin reference
      await db.WalletTransactions.create(
        {
          tenant_id,
          type: "credit",
          amount: amountInRupees,
          reference_id: reference_id || `admin_credit_${Date.now()}`,
          description: `Manual Credit: ${reason} (by admin: ${admin_id})`,
          balance_after: newBalance,
        },
        { transaction: t },
      );
    });

    // Emit socket update to tenant
    try {
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("payment-update", {
        type: "ADMIN_CREDIT",
        amount: amountInRupees,
        balance: newBalance,
        message: `₹${amountInRupees.toFixed(2)} credited: ${reason}`,
      });

      // If balance was restored, emit restoration event
      if (newBalance > 0) {
        io.to(`tenant-${tenant_id}`).emit("wallet-restored", {
          tenant_id,
          balance: newBalance,
          message: "Services restored! Your account is now active.",
        });
      }
    } catch (err) {
      console.error("[BILLING] Socket emit error:", err.message);
    }

    console.log(
      `[BILLING] Admin ${admin_id} credited ₹${amountInRupees.toFixed(2)} to tenant ${tenant_id}. Reason: ${reason}. New balance: ₹${newBalance.toFixed(2)}`,
    );

    return {
      success: true,
      tenant_id,
      amount: amountInRupees,
      newBalance,
      reason,
      message: "Credit added successfully",
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Get wallet status for a tenant (used by management panel)
 */
export const getWalletStatusService = async (tenant_id) => {
  try {
    const { checkWalletStatus } =
      await import("../../utils/billing/walletGuard.js");
    return await checkWalletStatus(tenant_id);
  } catch (error) {
    throw error;
  }
};

/**
 * Get tenant billing mode + cycle + credit info.
 */
export const getBillingModeService = async (tenant_id) => {
  try {
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: [
        "billing_mode",
        "billing_cycle_start",
        "billing_cycle_end",
        "postpaid_credit_limit",
        "max_daily_messages",
        "max_monthly_messages",
        "max_daily_ai_calls",
        "max_monthly_ai_calls",
      ],
      raw: true,
    });

    if (!tenant) throw new Error("Tenant not found");

    const result = {
      billing_mode: tenant.billing_mode || "prepaid",
      billing_cycle_start: tenant.billing_cycle_start,
      billing_cycle_end: tenant.billing_cycle_end,
      limits: {
        max_daily_messages: tenant.max_daily_messages,
        max_monthly_messages: tenant.max_monthly_messages,
        max_daily_ai_calls: tenant.max_daily_ai_calls,
        max_monthly_ai_calls: tenant.max_monthly_ai_calls,
      },
    };

    if (tenant.billing_mode === "postpaid") {
      const activeCycle = await db.BillingCycles.findOne({
        where: { tenant_id, status: "active" },
        raw: true,
      });
      result.postpaid = {
        credit_limit: parseFloat(tenant.postpaid_credit_limit) || 5000,
        current_usage: activeCycle
          ? parseFloat(activeCycle.total_cost_inr) || 0
          : 0,
        cycle_number: activeCycle?.cycle_number || 0,
      };
    }

    return result;
  } catch (error) {
    throw error;
  }
};
