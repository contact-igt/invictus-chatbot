import db from "../../database/index.js";
import cron from "node-cron";
import axios from "axios";
import { getIO } from "../../middlewares/socket/socket.js";

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

    // Prevent duplicate processing if we already handled this message_id
    const existingUsage = await db.MessageUsage.findOne({ where: { message_id } });
    if (existingUsage) {
      // If we already captured the cost, but string changed to delivered/read, just update status
      if (existingUsage.status !== status) {
         await existingUsage.update({ status });
      }
      return;
    }

    // Meta sends categories in UPPERCASE (e.g., "MARKETING"), normalize to lowercase for our ENUM
    const rawCategory = pricing.category || conversation?.origin?.type || "service";
    const category = rawCategory.toLowerCase();
    const billable = pricing.billable;
    const conversation_id = conversation?.id || null;

    // 1. Create MessageUsage Record (Tracks BOTH billable and free conversations)
    const usageRecord = await db.MessageUsage.create({
      tenant_id,
      message_id,
      conversation_id,
      category,
      billable,
      status, // 'sent'
      timestamp: new Date(),
    });

    // 2. Calculate Cost (Look up closest pricing rule)
    // In Meta, the appropriate country is critical for pricing. 
    // We determine the country from the recipient's phone number (recipient_id) in the webhook.
    const recipient_id = statusUpdate.recipient_id;
    let country = pricing?.pricing_model === 'CBP' ? 'Global' : 'US'; // Default fallback

    if (recipient_id) {
       // Extract country code from the recipient_id
       if (recipient_id.startsWith('91')) country = 'IN';
       else if (recipient_id.startsWith('44')) country = 'GB';
       else if (recipient_id.startsWith('1')) country = 'US';
       // We can expand this logic or use a library.
    } else {
      // Fallback: Check the tenant's default country if recipient_id is missing (rare)
      const tenant = await db.Tenants.findOne({ where: { tenant_id } });
      if (tenant && tenant.country) {
        country = tenant.country;
      }
    }

    let baseRate = 0;
    let markupPercent = 0;

    if (billable) {
      let pricingRule = await db.PricingTable.findOne({
        where: { category, country }
      });

      // If no specific country rule, try finding a global fallback rule for the category
      if (!pricingRule) {
        pricingRule = await db.PricingTable.findOne({
          where: { category, country: "Global" }
        });
      }

      // Default rates if no pricing rules are seeded in DB yet
      const defaultRates = {
        marketing: 0.075,
        utility: 0.015,
        authentication: 0.015,
        service: 0.00,
      };

      baseRate = pricingRule ? parseFloat(pricingRule.rate) : (defaultRates[category] || 0);
      markupPercent = pricingRule ? parseFloat(pricingRule.markup_percent) : 0;
    }
    
    const platformFee = baseRate * (markupPercent / 100);
    const totalCost = baseRate + platformFee;

    let template_name = null;
    let campaign_name = null;

    try {
      // 1. Fetch message details from our local database to get the template_name
      const msgRecord = await db.MessageUsage.findOne({ 
        where: { message_id },
        include: [{
          model: db.Messages,
          as: 'messageDetails', // Assuming association exists or we can just query directly
          attributes: ['template_name']
        }]
      });

      // Since we might not have a direct association defined in all environments, 
      // let's use a safe direct query or findOne on Messages
      const messageData = await db.Messages.findOne({
        where: { wamid: message_id },
        attributes: ['template_name']
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
        { replacements: [message_id] }
      );

      if (campaignRecipients.length > 0) {
        campaign_name = campaignRecipients[0].campaign_name;
        // Only override if not already set by Messages table (Messages table is more specific)
        if (!template_name) {
          template_name = campaignRecipients[0].template_name;
        }
      }
    } catch (err) {
      console.error("[BILLING] Error fetching message/campaign metadata:", err);
    }

    // 3. Create BillingLedger Record
    await db.BillingLedger.create({
      tenant_id,
      message_usage_id: usageRecord.id,
      template_name: template_name,
      campaign_name: campaign_name,
      category: category,
      country: country,
      rate: baseRate + platformFee,
      meta_cost: baseRate,
      platform_fee: platformFee,
      total_cost: totalCost,
      markup_percent: markupPercent,
    });

    console.log(`[BILLING] Billed conversation ${category} for tenant ${tenant_id}: $${totalCost.toFixed(4)}`);

    // 4. Emit real-time update via Socket
    try {
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("billing-update", {
        type: "NEW_LEDGER_ENTRY",
        tenant_id,
        category,
        totalCost,
        timestamp: new Date()
      });
    } catch (socketErr) {
      console.error("[BILLING SOCKET ERROR] Failed to emit billing update:", socketErr.message);
    }

  } catch (error) {
    console.error(`[BILLING ERROR] processing message ${statusUpdate?.id}:`, error);
  }
};

/**
 * Executes a daily Cron job to fetch official conversation analytics from Meta.
 * This ensures our local database resolves any discrepancies with actual Meta charges.
 */
export const startDailyMetaBillingSyncCronService = () => {
  // Run every day at 00:00 (Midnight)
  cron.schedule("0 0 * * *", async () => {
    console.log("[CRON] Starting Daily Meta Billing Sync...");
    
    try {
      // 1. Fetch all active tenants with configured WhatsApp Business Accounts
      const [accounts] = await db.sequelize.query(
        `SELECT tenant_id, waba_id, access_token FROM whatsapp_accounts WHERE status = 'active' AND is_deleted = false`
      );

      for (const account of accounts) {
        if (!account.waba_id || !account.access_token) continue;

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const start = parseInt(yesterday.setHours(0, 0, 0, 0) / 1000);
        const end = parseInt(yesterday.setHours(23, 59, 59, 999) / 1000);

        try {
          // 2. Fetch official conversation analytics from Meta Graph API
          const response = await axios.get(
            `https://graph.facebook.com/v19.0/${account.waba_id}/conversation_analytics`,
            {
              params: {
                start,
                end,
                granularity: "DAILY",
                dimensions: ["CONVERSATION_CATEGORY", "CONVERSATION_TYPE", "COUNTRY"],
                access_token: account.access_token,
              },
            }
          );

          // 3. (Implementation detail) Here we parse response.data.data
          // and compare the counts against our local MessageUsage daily counts.
          // For Stage 1, we ensure the infrastructure exists and the job triggers successfully.
          console.log(`[CRON] Meta billing data synced for tenant ${account.tenant_id}. Data points: ${response.data?.data?.length || 0}`);

        } catch (apiErr) {
          console.error(`[CRON] Meta API Error resolving billing for tenant ${account.tenant_id}:`, apiErr?.response?.data || apiErr.message);
        }
      }

      console.log("[CRON] Daily Meta Billing Sync completed.");
    } catch (err) {
      console.error("[CRON] Global Daily Meta Billing Sync Error:", err);
    }
  });
};

/**
 * Fetches the high-level Billing KPIs for a tenant.
 */
export const getBillingKpiService = async (tenant_id) => {
  try {
    const ledgers = await db.BillingLedger.findAll({
      where: { tenant_id },
    });

    let totalSpentEstimated = 0;
    let marketingSpent = 0;
    let utilitySpent = 0;
    let authSpent = 0;

    ledgers.forEach((l) => {
      const cost = parseFloat(l.total_cost) || 0;
      totalSpentEstimated += cost;
      if (l.category === "marketing") marketingSpent += cost;
      else if (l.category === "utility") utilitySpent += cost;
      else if (l.category === "authentication") authSpent += cost;
    });

    const totalMessagesSent = await db.MessageUsage.count({
      where: { tenant_id },
    });

    const billableConversations = await db.MessageUsage.count({
      where: { tenant_id, billable: true },
    });

    const freeConversations = await db.MessageUsage.count({
      where: { tenant_id, billable: false },
    });

    return {
      totalSpentEstimated,
      marketingSpent,
      utilitySpent,
      authSpent,
      totalMessagesSent,
      billableConversations,
      freeConversations,
    };
  } catch (error) {
    throw error;
  }
};

/**
 * Fetches paginated billing ledger history for a tenant.
 */
export const getBillingLedgerService = async (tenant_id, page = 1, limit = 50, category) => {
  try {
    const offset = (page - 1) * limit;

    const whereClause = { tenant_id };
    if (category && category !== "All") {
      whereClause.category = category.toLowerCase();
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
        },
      ],
    });

    const records = rows.map((ledger) => ({
      id: ledger.id,
      date: ledger.createdAt,
      category: ledger.category,
      template: ledger.template_name || "—",
      campaign: ledger.campaign_name || "—",
      messages: 1, // Currently 1 per webhook event
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
export const getBillingSpendChartService = async (tenant_id) => {
  try {
    const ledgers = await db.BillingLedger.findAll({
      where: { tenant_id },
      order: [["created_at", "ASC"]],
    });

    const spendMap = {};

    ledgers.forEach((l) => {
      const dateKey = new Date(l.createdAt).toISOString().split("T")[0];
      if (!spendMap[dateKey]) {
        spendMap[dateKey] = { date: dateKey, marketing: 0, utility: 0, auth: 0 };
      }
      const cost = parseFloat(l.total_cost) || 0;
      if (l.category === "marketing") spendMap[dateKey].marketing += cost;
      else if (l.category === "utility") spendMap[dateKey].utility += cost;
      else if (l.category === "authentication") spendMap[dateKey].auth += cost;
      else if (l.category === "service") spendMap[dateKey].service = (spendMap[dateKey].service || 0) + cost;
    });

    return Object.values(spendMap);
  } catch (error) {
    throw error;
  }
};
