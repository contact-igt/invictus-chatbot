import db from "../../database/index.js";
import { Op } from "sequelize";
import cron from "node-cron";
import axios from "axios";
import libphonenumber from "google-libphonenumber";
import { getIO } from "../../middlewares/socket/socket.js";

const phoneUtil = libphonenumber.PhoneNumberUtil.getInstance();

/**
 * Processes Meta Webhook status updates to calculate billing.
 * Meta includes pricing and conversation models in "sent" or "delivered" statuses.
 */
export const processBillingFromWebhook = async (tenant_id, statusUpdate) => {
  try {
    const { id: message_id, status, pricing, conversation } = statusUpdate;

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
      }
      return;
    }

    // 2. Calculate Cost (Look up closest pricing rule)
    // In Meta, the appropriate country is critical for pricing.
    // We determine the country accurately from the recipient's phone number using libphonenumber.
    const recipient_id = statusUpdate.recipient_id;
    let country = "Global"; // Default fallback

    if (recipient_id) {
      try {
        // Meta recipient IDs are usually digits only. libphonenumber needs a '+' for international parsing
        // without a default region, or we can try to parse it as is if it looks like it has a CC.
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
        // Fallback to the old prefix logic for common cases if parsing fails
        if (recipient_id.startsWith("91")) country = "IN";
        else if (recipient_id.startsWith("44")) country = "GB";
        else if (recipient_id.startsWith("1")) country = "US";
      }
    }

    // Final fallback: Check the tenant's default country if detection failed
    if (country === "Global") {
      const tenant = await db.Tenants.findOne({ where: { tenant_id } });
      if (tenant && tenant.country) {
        country = tenant.country;
      }
    }

    let baseRate = 0;
    let markupPercent = 0;

    if (billable) {
      let pricingRule = await db.PricingTable.findOne({
        where: { category, country },
      });

      // If no specific country rule, try finding a global fallback rule for the category
      if (!pricingRule) {
        pricingRule = await db.PricingTable.findOne({
          where: { category, country: "Global" },
        });
      }

      // Default rates if no pricing rules are seeded in DB yet
      const defaultRates = {
        marketing: 0.075,
        utility: 0.015,
        authentication: 0.015,
        service: 0.0,
      };

      baseRate = pricingRule
        ? parseFloat(pricingRule.rate)
        : defaultRates[category] || 0;
      markupPercent = pricingRule ? parseFloat(pricingRule.markup_percent) : 0;
    }

    const platformFee = baseRate * (markupPercent / 100);
    const totalCost = baseRate + platformFee;

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

    // 3. Create BillingLedger Record and Deduct Wallet Balance (Atomic Transaction)
    // Use findOrCreate to prevent duplicate billing for the same message
    await db.sequelize.transaction(async (t) => {
      // Prevent duplicate billing - check if ledger already exists for this message
      const [ledger, ledgerCreated] = await db.BillingLedger.findOrCreate({
        where: { message_usage_id: usageRecord.id },
        defaults: {
          tenant_id,
          message_usage_id: usageRecord.id,
          template_name: template_name,
          campaign_name: campaign_name,
          category: category,
          country: country,
          rate: baseRate,
          meta_cost: baseRate,
          platform_fee: platformFee,
          total_cost: totalCost,
          markup_percent: markupPercent,
        },
        transaction: t,
      });

      // If ledger already existed, skip wallet deduction (already billed)
      if (!ledgerCreated) {
        console.log(
          `[BILLING] Skipping duplicate billing for message_usage_id ${usageRecord.id}`,
        );
        return;
      }

      if (totalCost > 0) {
        // Find or create wallet
        let [wallet] = await db.Wallets.findOrCreate({
          where: { tenant_id },
          defaults: { tenant_id, balance: 0, currency: "INR" },
          transaction: t,
        });

        // NaN protection: ensure balance is a valid number
        const oldBalance = parseFloat(wallet.balance) || 0;
        const newBalance = oldBalance - totalCost;

        await wallet.update({ balance: newBalance }, { transaction: t });

        // Record the transaction with balance_after for audit trail
        await db.WalletTransactions.create(
          {
            tenant_id,
            type: "debit",
            amount: totalCost,
            reference_id: `ledger_${ledger.id}`,
            description: `Message Billing: ${category} (${country})`,
            balance_after: newBalance,
          },
          { transaction: t },
        );
      }
    });

    // Check wallet balance after deduction for low balance warning
    let currentBalance = 0;
    let wallet = null;
    try {
      wallet = await db.Wallets.findOne({ where: { tenant_id } });
      if (wallet) currentBalance = parseFloat(wallet.balance);
    } catch (e) {}

    console.log(
      `[BILLING] Billed ${category} for tenant ${tenant_id}: ₹${totalCost.toFixed(4)}. Ledger and Wallet updated. Balance: ₹${currentBalance.toFixed(4)}`,
    );

    // 4. Emit real-time update via Socket
    try {
      const io = getIO();
      const payload = {
        type: "NEW_LEDGER_ENTRY",
        tenant_id,
        category,
        totalCost,
        currentBalance,
        lowBalance: currentBalance < 100,
        timestamp: new Date(),
      };
      io.to(`tenant-${tenant_id}`).emit("billing-update", payload);

      // Emit dedicated low balance warning if balance drops below ₹100
      if (currentBalance < 100) {
        io.to(`tenant-${tenant_id}`).emit("low-balance-warning", {
          balance: currentBalance,
          message:
            currentBalance <= 0
              ? "Wallet balance is zero or negative. Recharge immediately to continue messaging."
              : `Wallet balance is low (₹${currentBalance.toFixed(2)}). Please recharge soon.`,
        });
      }

      // 5. Auto-recharge trigger: notify frontend to initiate Razorpay payment
      if (
        wallet &&
        wallet.auto_recharge_enabled &&
        currentBalance < parseFloat(wallet.auto_recharge_threshold)
      ) {
        const rechargeAmount = parseFloat(wallet.auto_recharge_amount);
        console.log(
          `[AUTO-RECHARGE] Balance ₹${currentBalance.toFixed(2)} below threshold ₹${parseFloat(wallet.auto_recharge_threshold).toFixed(2)}. Triggering auto-recharge of ₹${rechargeAmount.toFixed(2)} for tenant ${tenant_id}`,
        );
        io.to(`tenant-${tenant_id}`).emit("auto-recharge-trigger", {
          balance: currentBalance,
          threshold: parseFloat(wallet.auto_recharge_threshold),
          amount: rechargeAmount,
          message: `Auto-recharge triggered: Balance ₹${currentBalance.toFixed(2)} is below threshold ₹${parseFloat(wallet.auto_recharge_threshold).toFixed(2)}. Initiating ₹${rechargeAmount.toFixed(2)} recharge.`,
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

    // 1. Calculate category-wise spent using aggregation
    const categoryTotals = await db.BillingLedger.findAll({
      attributes: [
        "category",
        [db.sequelize.fn("SUM", db.sequelize.col("total_cost")), "totalSpent"],
      ],
      where: whereClause,
      group: ["category"],
    });

    let totalSpentEstimated = 0;
    let marketingSpent = 0;
    let utilitySpent = 0;
    let authSpent = 0;
    let serviceSpent = 0;

    categoryTotals.forEach((result) => {
      const category = result.category;
      const total = parseFloat(result.get("totalSpent")) || 0;
      totalSpentEstimated += total;
      if (category === "marketing") marketingSpent = total;
      else if (category === "utility") utilitySpent = total;
      else if (category === "authentication") authSpent = total;
      else if (category === "service") serviceSpent = total;
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
      totalSpentEstimated,
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
      const cost = parseFloat(l.total_cost) || 0;
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
    return {
      balance,
      currency: wallet.currency || "INR",
      lowBalance: balance < 100,
      balanceStatus:
        balance <= 0 ? "critical" : balance < 100 ? "low" : "healthy",
      autoRecharge: {
        enabled: wallet.auto_recharge_enabled || false,
        threshold: parseFloat(wallet.auto_recharge_threshold) || 100,
        amount: parseFloat(wallet.auto_recharge_amount) || 500,
      },
    };
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
        [db.sequelize.fn("SUM", db.sequelize.col("total_cost")), "totalCost"],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "messageCount"],
        [db.sequelize.fn("AVG", db.sequelize.col("rate")), "avgRate"],
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
        [db.sequelize.fn("SUM", db.sequelize.col("total_cost")), "totalCost"],
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "recipientCount"],
        [
          db.sequelize.fn("AVG", db.sequelize.col("rate")),
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
    let usdToInr = 85;
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

    return {
      summary: {
        totalPromptTokens: parseInt(totals?.totalPromptTokens) || 0,
        totalCompletionTokens: parseInt(totals?.totalCompletionTokens) || 0,
        totalTokens: parseInt(totals?.totalTokens) || 0,
        totalCostUsd,
        totalCostInr: totalCostUsd * usdToInr,
        totalCalls: parseInt(totals?.totalCalls) || 0,
      },
      byModel: byModel.map((m) => ({
        model: m.model,
        promptTokens: parseInt(m.promptTokens) || 0,
        completionTokens: parseInt(m.completionTokens) || 0,
        totalTokens: parseInt(m.totalTokens) || 0,
        costUsd: parseFloat(m.costUsd) || 0,
        calls: parseInt(m.calls) || 0,
      })),
      bySource: bySource.map((s) => ({
        source: s.source,
        totalTokens: parseInt(s.totalTokens) || 0,
        costUsd: parseFloat(s.costUsd) || 0,
        calls: parseInt(s.calls) || 0,
      })),
      daily: daily.map((d) => ({
        date: d.date,
        totalTokens: parseInt(d.totalTokens) || 0,
        costUsd: parseFloat(d.costUsd) || 0,
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
    const usdToInr = parseFloat(m.usd_to_inr_rate) || 85;
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

      // If balance was restored from suspended state, emit restoration event
      if (newBalance > 0) {
        const { checkAndRestoreWallet } =
          await import("../../utils/billing/walletGuard.js");
        await checkAndRestoreWallet(tenant_id, newBalance);
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
