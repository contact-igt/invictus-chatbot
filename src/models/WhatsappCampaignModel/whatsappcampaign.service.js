import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";
import { sendWhatsAppTemplate } from "../AuthWhatsapp/AuthWhatsapp.service.js";
import { createContactService, getContactByPhoneAndTenantIdService } from "../ContactsModel/contacts.service.js";
import { createUserMessageService } from "../Messages/messages.service.js";
import cron from "node-cron";

/**
 * Creates a new campaign and populates its recipients.
 * Supports three audience types: manual, group, csv
 */
export const createCampaignService = async (tenant_id, data, created_by) => {
    const transaction = await db.sequelize.transaction();
    try {
        const {
            campaign_name,
            campaign_type,
            template_id,
            audience_type, // "manual" | "group" | "csv"
            audience_data, // Array of recipients OR group_id
            scheduled_at
        } = data;

        // 0. Check for duplicate campaign name
        const existingCampaign = await db.WhatsappCampaigns.findOne({
            where: { tenant_id, campaign_name, is_deleted: false },
        });

        if (existingCampaign) {
            throw new Error(`A campaign with the name "${campaign_name}" already exists.`);
        }

        // 1. Generate Campaign ID
        const campaign_id = await generateReadableIdFromLast(
            tableNames.WHATSAPP_CAMPAIGN,
            "campaign_id",
            "CAMP",
            5
        );

        // 2. Resolve recipients based on audience_type
        let recipients = [];

        if (audience_type === "manual" || audience_type === "csv") {
            // Manual: Frontend sends array of { mobile_number, name?, dynamic_variables?: [...] }
            // CSV: Frontend parses CSV and sends same format
            recipients = audience_data.map((item) => ({
                mobile_number: item.mobile_number,
                contact_id: item.contact_id || null,
                dynamic_variables: item.dynamic_variables || null, // e.g., ['John', '10:00 AM']
            }));
        } else if (audience_type === "group") {
            // Group: Fetch all members from the group
            const group_id = audience_data; // audience_data is just the group_id string

            const groupMembers = await db.ContactGroupMembers.findAll({
                where: { group_id, tenant_id },
                include: [
                    {
                        model: db.Contacts,
                        as: "contact",
                        attributes: ["contact_id", "phone", "name"],
                        where: { is_deleted: false },
                    },
                ],
            });

            if (groupMembers.length === 0) {
                throw new Error("Group has no members or does not exist");
            }

            recipients = groupMembers.map((member) => ({
                mobile_number: member.contact.phone,
                contact_id: member.contact.contact_id,
                dynamic_variables: null, // Groups don't have per-contact variables by default
            }));
        } else {
            throw new Error("Invalid audience_type. Must be 'manual', 'group', or 'csv'");
        }

        // 3. Create Campaign Record
        const campaign = await db.WhatsappCampaigns.create(
            {
                campaign_id,
                tenant_id,
                campaign_name,
                campaign_type,
                template_id,
                status: campaign_type === "scheduled" ? "scheduled" : "active", // Changed from "draft" to "active" for Send Now
                total_audience: recipients.length,
                scheduled_at,
                created_by,
            },
            { transaction }
        );

        // 4. Bulk Create Recipients with dynamic_variables
        const recipientData = recipients.map((r) => ({
            campaign_id,
            mobile_number: r.mobile_number,
            contact_id: r.contact_id || null,
            dynamic_variables: r.dynamic_variables, // Store the array of values
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
export const getCampaignByIdService = async (campaign_id, tenant_id, query = {}) => {
    const { recipient_status } = query;
    let recipientWhere = { campaign_id };
    if (recipient_status) {
        recipientWhere.status = recipient_status;
    }

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
                where: recipientWhere,
                required: false, // Ensure campaign is returned even if no recipients match filter
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

    // Fetch Template Body Text
    const [[bodyComponent]] = await db.sequelize.query(
        `SELECT text_content FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ? AND component_type = 'body' LIMIT 1`,
        { replacements: [campaign.template_id] },
    );
    const templateBodyText = bodyComponent?.text_content || `Template: ${campaign.template.template_name}`;

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
            // 1. Ensure Contact Exists
            let contactId = recipient.contact_id;
            if (!contactId) {
                const existingContact = await getContactByPhoneAndTenantIdService(tenant_id, recipient.mobile_number);
                if (existingContact) {
                    contactId = existingContact.contact_id;
                } else {
                    const newContact = await createContactService(tenant_id, recipient.mobile_number, null, null);
                    contactId = newContact.contact_id;
                }

                if (contactId) {
                    await recipient.update({ contact_id: contactId });
                }
            }

            let components = [];

            let dynamicVariables = recipient.dynamic_variables || [];
            if (typeof dynamicVariables === 'string') {
                try {
                    dynamicVariables = JSON.parse(dynamicVariables);
                } catch (e) {
                    dynamicVariables = [];
                }
            }

            if (Array.isArray(dynamicVariables) && dynamicVariables.length > 0) {
                components = [
                    {
                        type: "body",
                        parameters: dynamicVariables.map((v) => ({
                            type: "text",
                            text: v,
                        })),
                    },
                ];
            }

            const result = await sendWhatsAppTemplate(
                tenant_id,
                recipient.mobile_number,
                campaign.template.template_name,
                campaign.template.language,
                components,
            );

            await recipient.update({
                status: "sent",
                meta_message_id: result.meta_message_id || null,
            });

            // 3. Log to Message History
            if (contactId && result.meta_message_id) {
                let personalizedMessage = templateBodyText;
                if (Array.isArray(dynamicVariables) && dynamicVariables.length > 0) {
                    dynamicVariables.forEach((val, idx) => {
                        personalizedMessage = personalizedMessage.replace(`{{${idx + 1}}}`, val);
                    });
                }

                await createUserMessageService(
                    tenant_id,
                    contactId,
                    result.phone_number_id,
                    recipient.mobile_number,
                    result.meta_message_id,
                    "System",
                    "admin",
                    null,
                    personalizedMessage,
                    "template",
                    null,
                    null,
                    "sent"
                );
            }
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
 * Soft delete a campaign
 */
export const softDeleteCampaignService = async (campaign_id, tenant_id) => {
    const campaign = await db.WhatsappCampaigns.findOne({
        where: { campaign_id, tenant_id, is_deleted: false }
    });

    if (!campaign) {
        throw new Error("Campaign not found");
    }

    await campaign.update({
        is_deleted: true,
        deleted_at: new Date()
    });

    return { message: "Campaign soft deleted successfully" };
};

/**
 * Permanently delete a campaign and its recipients
 */
export const permanentDeleteCampaignService = async (campaign_id, tenant_id) => {
    const transaction = await db.sequelize.transaction();
    try {
        const campaign = await db.WhatsappCampaigns.findOne({
            where: { campaign_id, tenant_id }
        });

        if (!campaign) {
            throw new Error("Campaign not found");
        }

        // Delete all recipients first
        await db.WhatsappCampaignRecipients.destroy({
            where: { campaign_id },
            transaction
        });

        // Delete the campaign
        await campaign.destroy({ transaction });

        await transaction.commit();
        return { message: "Campaign and its data permanently deleted" };
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
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

