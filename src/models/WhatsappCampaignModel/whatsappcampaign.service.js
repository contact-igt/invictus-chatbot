import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";
import { sendWhatsAppTemplate } from "../AuthWhatsapp/AuthWhatsapp.service.js";
import cron from "node-cron";

/**
 * Creates a new campaign and populates its recipients.
 */
export const createCampaignService = async (tenant_id, data, created_by) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { campaign_name, campaign_type, template_id, recipients, scheduled_at } = data;

        // 1. Generate Campaign ID
        const campaign_id = await generateReadableIdFromLast(
            tableNames.WHATSAPP_CAMPAIGN,
            "campaign_id",
            "CAMP",
            5
        );

        // 2. Create Campaign Record
        const campaign = await db.WhatsappCampaigns.create(
            {
                campaign_id,
                tenant_id,
                campaign_name,
                campaign_type,
                template_id,
                status: campaign_type === "scheduled" ? "scheduled" : "draft",
                total_audience: recipients.length,
                scheduled_at,
                created_by,
            },
            { transaction }
        );

        // 3. Bulk Create Recipients
        const recipientData = recipients.map((r) => ({
            campaign_id,
            mobile_number: r.mobile_number,
            contact_id: r.contact_id || null,
            status: "pending",
        }));

        await db.WhatsappCampaignRecipients.bulkCreate(recipientData, { transaction });

        await transaction.commit();
        return campaign;
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
};

/**
 * Retrieves a list of campaigns for a tenant with filtering.
 */
export const getCampaignListService = async (tenant_id, query) => {
    const { status, type, search, page = 1, limit = 10 } = query;
    const offset = (page - 1) * limit;

    let where = { tenant_id, is_deleted: false };
    if (status) where.status = status;
    if (type) where.campaign_type = type;
    if (search) {
        where.campaign_name = { [db.Sequelize.Op.like]: `%${search}%` };
    }

    const { count, rows } = await db.WhatsappCampaigns.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit: parseInt(limit),
        offset: parseInt(offset),
        include: [
            {
                model: db.WhatsappTemplates,
                as: "template",
                attributes: ["template_name", "category", "language"],
            },
        ],
    });

    return {
        totalItems: count,
        campaigns: rows,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
    };
};

/**
 * Retrieves detailed info for a single campaign.
 */
export const getCampaignByIdService = async (campaign_id, tenant_id) => {
    const campaign = await db.WhatsappCampaigns.findOne({
        where: { campaign_id, tenant_id, is_deleted: false },
        include: [
            {
                model: db.WhatsappTemplates,
                as: "template",
            },
            {
                model: db.WhatsappCampaignRecipients,
                as: "recipients",
                limit: 100, // Preview of first 100 recipients
            },
        ],
    });
    return campaign;
};

/**
 * Processes a batch of pending recipients for an active campaign.
 */
export const executeCampaignBatchService = async (campaign_id, tenant_id, batchSize = 50) => {
    const campaign = await db.WhatsappCampaigns.findOne({
        where: { campaign_id, tenant_id, status: ["active", "scheduled"] },
        include: [
            {
                model: db.WhatsappTemplates,
                as: "template",
            },
        ],
    });

    if (!campaign) {
        throw new Error("Campaign not found or not in executable state");
    }

    const recipients = await db.WhatsappCampaignRecipients.findAll({
        where: { campaign_id, status: "pending" },
        limit: batchSize,
    });

    if (recipients.length === 0) {
        // Mark campaign as completed if no more pending recipients
        await campaign.update({ status: "completed" });
        return { finished: true };
    }

    // Update campaign status to active if it was scheduled
    if (campaign.status === "scheduled") {
        await campaign.update({ status: "active" });
    }

    for (const recipient of recipients) {
        try {
            const response = await sendWhatsAppTemplate(
                tenant_id,
                recipient.mobile_number,
                campaign.template.template_name,
                campaign.template.language,
                [] // TODO: Support dynamic variables from CSV/Group later
            );

            await recipient.update({
                status: "sent",
                meta_message_id: response.meta_message_id || null,
            });
        } catch (err) {
            console.error(`Failed to send campaign message to ${recipient.mobile_number}:`, err.message);
            await recipient.update({
                status: "failed",
                error_message: err.message,
            });
        }
    }

    return { finished: false, processedCount: recipients.length };
};

/**
 * Starts a cron job to handle scheduled and active campaigns.
 */
export const startCampaignSchedulerService = () => {
    console.log("🚀 WhatsApp Campaign Scheduler Started");

    // Run every minute
    cron.schedule("* * * * *", async () => {
        try {
            // 1. Check for scheduled campaigns that need to be activated
            const [scheduledToActive] = await db.sequelize.query(`
        UPDATE ${tableNames.WHATSAPP_CAMPAIGN}
        SET status = 'active'
        WHERE status = 'scheduled' 
          AND scheduled_at <= NOW() 
          AND is_deleted = false
      `);

            // 2. Fetch all active campaigns
            const activeCampaigns = await db.WhatsappCampaigns.findAll({
                where: { status: "active", is_deleted: false },
            });

            for (const campaign of activeCampaigns) {
                // Execute a batch for each active campaign
                await executeCampaignBatchService(campaign.campaign_id, campaign.tenant_id, 100);
            }
        } catch (err) {
            console.error("Campaign Scheduler Error:", err.message);
        }
    });
};
