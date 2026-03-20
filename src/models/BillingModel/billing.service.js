import db from "../../database/index.js";
import { Op } from "sequelize";
import cron from "node-cron";
import axios from "axios";
import libphonenumber from 'google-libphonenumber';
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
    // We determine the country accurately from the recipient's phone number using libphonenumber.
    const recipient_id = statusUpdate.recipient_id;
    let country = 'Global'; // Default fallback

    if (recipient_id) {
      try {
        // Meta recipient IDs are usually digits only. libphonenumber needs a '+' for international parsing 
        // without a default region, or we can try to parse it as is if it looks like it has a CC.
        const phoneStr = recipient_id.startsWith('+') ? recipient_id : `+${recipient_id}`;
        const number = phoneUtil.parseAndKeepRawInput(phoneStr);
        const regionCode = phoneUtil.getRegionCodeForNumber(number);

        if (regionCode) {
          country = regionCode;
        }
      } catch (phoneErr) {
        console.warn(`[BILLING] Failed to parse recipient_id ${recipient_id} for country detection:`, phoneErr.message);
        // Fallback to the old prefix logic for common cases if parsing fails
        if (recipient_id.startsWith('91')) country = 'IN';
        else if (recipient_id.startsWith('44')) country = 'GB';
        else if (recipient_id.startsWith('1')) country = 'US';
      }
    }

    // Final fallback: Check the tenant's default country if detection failed
    if (country === 'Global') {
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

    categoryTotals.forEach((result) => {
      const category = result.category;
      const total = parseFloat(result.get("totalSpent")) || 0;
      totalSpentEstimated += total;
      if (category === "marketing") marketingSpent = total;
      else if (category === "utility") utilitySpent = total;
      else if (category === "authentication") authSpent = total;
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
export const getBillingLedgerService = async (tenant_id, page = 1, limit = 50, category, startDate, endDate) => {
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
export const getBillingSpendChartService = async (tenant_id, startDate, endDate) => {
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
