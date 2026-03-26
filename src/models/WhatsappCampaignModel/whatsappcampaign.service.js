import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { sendWhatsAppTemplate } from "../AuthWhatsapp/AuthWhatsapp.service.js";
import {
  createContactService,
  getContactByPhoneAndTenantIdService,
} from "../ContactsModel/contacts.service.js";
import { createUserMessageService } from "../Messages/messages.service.js";
import {
  createLeadService,
  getLeadByContactIdService,
} from "../LeadsModel/leads.service.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";
import {
  createLiveChatService,
  getLivechatByIdService,
  updateLiveChatTimestampService,
} from "../LiveChatModel/livechat.service.js";
import cron from "node-cron";
import { generateWhatsAppOTPService } from "../OtpVerificationModel/otpverification.service.js";

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
      scheduled_at,
      header_media_url,
      header_file_name,
      location_params,
      card_media_urls,
    } = data;

    // 0. Check for duplicate campaign name
    const existingCampaign = await db.WhatsappCampaigns.findOne({
      where: { tenant_id, campaign_name, is_deleted: false },
    });

    if (existingCampaign) {
      throw new Error(
        `A campaign with the name "${campaign_name}" already exists.`,
      );
    }

    // 1. Generate Campaign ID
    const campaign_id = await generateReadableIdFromLast(
      tableNames.WHATSAPP_CAMPAIGN,
      "campaign_id",
      "CAMP",
      5,
    );

    // 2. Resolve recipients based on audience_type
    let recipients = [];

    if (audience_type === "manual" || audience_type === "csv") {
      // Manual: Frontend sends array of { mobile_number, name?, dynamic_variables?: [...] }
      // CSV: Frontend parses CSV and sends same format
      if (!Array.isArray(audience_data) || audience_data.length === 0) {
        throw new Error(
          "audience_data must be a non-empty array for manual/csv audience type",
        );
      }

      // Remove potential duplicates or empty entries by mobile_number
      const seenNumbers = new Set();
      recipients = audience_data
        .filter((item) => item.mobile_number)
        .map((item) => {
          const formatted = formatPhoneNumber(item.mobile_number);
          if (seenNumbers.has(formatted)) return null;
          seenNumbers.add(formatted);
          return {
            mobile_number: formatted,
            contact_id: item.contact_id || null,
            dynamic_variables: item.dynamic_variables || null,
          };
        })
        .filter(Boolean);

      if (recipients.length === 0) {
        throw new Error("No valid recipients provided in audience data");
      }
    } else if (audience_type === "group") {
      if (Array.isArray(audience_data) && audience_data.length > 0) {
        // Per-member mode: frontend sent individual recipients with per-member dynamic_variables
        // Used when template has variables and user filled them per-member in Step 3
        const seenNumbers = new Set();
        recipients = audience_data
          .filter((item) => item.mobile_number)
          .map((item) => {
            const formatted = formatPhoneNumber(item.mobile_number);
            if (seenNumbers.has(formatted)) return null;
            seenNumbers.add(formatted);
            return {
              mobile_number: formatted,
              contact_id: item.contact_id || null,
              dynamic_variables: item.dynamic_variables || null,
            };
          })
          .filter(Boolean);

        if (recipients.length === 0) {
          throw new Error("No valid recipients in group audience data");
        }
      } else {
        // Plain group_id mode: fetch all members from DB, send same message to all
        const group_id = audience_data;

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
          dynamic_variables: null,
        }));
      }
    } else {
      throw new Error(
        "Invalid audience_type. Must be 'manual', 'group', or 'csv'",
      );
    }

    // 2.5 Campaign Safety: Validate against rolling 24h limit
    const account = await db.Whatsappaccount.findOne({
      where: { tenant_id, is_deleted: false },
    });
    if (!account) throw new Error("WhatsApp account not found or deactivated.");

    let limit = 1000;
    if (account.tier === "TIER_10K") limit = 10000;
    else if (account.tier === "TIER_100K") limit = 100000;
    else if (account.tier === "TIER_UNLIMITED") limit = Infinity;

    if (limit !== Infinity) {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [usedRow] = await db.sequelize.query(
        `
                SELECT COUNT(DISTINCT contact_id) as used
                FROM messages
                WHERE tenant_id = :tenant_id
                  AND sender IN ('bot', 'admin')
                  AND created_at >= :targetTime
            `,
        {
          replacements: {
            tenant_id,
            targetTime: twentyFourHoursAgo.toISOString(),
          },
          type: db.sequelize.QueryTypes.SELECT,
        },
      );

      const used = parseInt(usedRow?.used || 0, 10);
      const remaining = Math.max(0, limit - used);

      if (recipients.length > remaining) {
        throw new Error(
          `Campaign blocked: Exceeds 24h messaging limits. You have ${remaining} conversations remaining but attempted to send to ${recipients.length} users.`,
        );
      }
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
        header_media_url,
        header_file_name,
        location_params,
        card_media_urls,
        created_by,
      },
      { transaction },
    );

    // 4. Bulk Create Recipients with dynamic_variables
    const recipientData = recipients.map((r) => ({
      campaign_id,
      mobile_number: r.mobile_number,
      contact_id: r.contact_id || null,
      dynamic_variables: r.dynamic_variables, // Store the array of values
      status: "pending",
    }));

    await db.WhatsappCampaignRecipients.bulkCreate(recipientData, {
      transaction,
    });

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
export const getCampaignListService = async (tenant_id, query = {}) => {
  try {
    const { page = 1, limit = 10, status } = query;
    const offset = (page - 1) * limit;

    const where = { tenant_id, is_deleted: false };
    if (status) {
      where.status = status;
    }

    const { count, rows } = await db.WhatsappCampaigns.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      include: [
        {
          model: db.WhatsappTemplates,
          as: "template",
          attributes: ["template_name", "category", "language"],
        },
      ],
    });

    return {
      campaigns: rows,
      totalItems: count,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page, 10),
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Retrieves detailed info for a single campaign.
 */
export const getCampaignByIdService = async (
  campaign_id,
  tenant_id,
  query = {},
) => {
  try {
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
  } catch (err) {
    throw err;
  }
};

/**
 * Processes a batch of pending recipients for an active campaign.
 */
export const executeCampaignBatchService = async (
  campaign_id,
  tenant_id,
  batchSize = 50,
) => {
  try {
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

    if (!campaign.template) {
      console.error(`Campaign ${campaign_id} has no template details`);
      await campaign.update({ status: "failed" });
      return { finished: true };
    }

    // Fetch Template Components (Body, Header, Footer, Buttons)
    const [components_data] = await db.sequelize.query(
      `SELECT component_type, text_content, header_format FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ? AND component_type IN ('body', 'header', 'footer', 'buttons')`,
      { replacements: [campaign.template_id] },
    );

    const bodyComponent = components_data.find(
      (c) => c.component_type === "body",
    );
    const headerComponent = components_data.find(
      (c) => c.component_type === "header",
    );
    const footerComponent = components_data.find(
      (c) => c.component_type === "footer",
    );
    const buttonsComponent = components_data.find(
      (c) => c.component_type === "buttons",
    );

    const templateBodyText =
      bodyComponent?.text_content ||
      `Template: ${campaign.template.template_name}`;
    const headerFormat = headerComponent?.header_format;

    // Extract run-time parameters from campaign
    const campaignHeaderMediaUrl = campaign.header_media_url;
    let campaignLocationParams = campaign.location_params;
    let campaignCardMediaUrls = campaign.card_media_urls;

    if (typeof campaignLocationParams === "string") {
      try {
        campaignLocationParams = JSON.parse(campaignLocationParams);
      } catch (e) {
        campaignLocationParams = null;
      }
    }
    if (typeof campaignCardMediaUrls === "string") {
      try {
        campaignCardMediaUrls = JSON.parse(campaignCardMediaUrls);
      } catch (e) {
        campaignCardMediaUrls = null;
      }
    }

    if (recipients.length === 0) {
      // Mark campaign as completed if no more pending recipients
      await campaign.update({ status: "completed" });
      return { finished: true };
    }

    // Update campaign status to active if it was scheduled or draft
    if (campaign.status === "scheduled" || campaign.status === "draft") {
      await campaign.update({ status: "active" });
    }

    for (const recipient of recipients) {
      try {
        // 1. Ensure Contact Exists
        let contactId = recipient.contact_id;
        if (!contactId) {
          const existingContact = await getContactByPhoneAndTenantIdService(
            tenant_id,
            recipient.mobile_number,
          );
          if (existingContact) {
            contactId = existingContact.contact_id;
          } else {
            const newContact = await createContactService(
              tenant_id,
              recipient.mobile_number,
              null,
              null,
            );
            contactId = newContact.contact_id;
          }

          if (contactId) {
            await recipient.update({ contact_id: contactId });
          }
        }

        // 2. Ensure Lead Exists for this Contact
        if (contactId) {
          const existingLead = await getLeadByContactIdService(
            tenant_id,
            contactId,
          );
          if (!existingLead) {
            await createLeadService(tenant_id, contactId, "campaign");
          }
        }

        let components = [];

        let dynamicVariables = recipient.dynamic_variables || [];
        if (typeof dynamicVariables === "string") {
          try {
            dynamicVariables = JSON.parse(dynamicVariables);
          } catch (e) {
            dynamicVariables = [];
          }
        }

        // ── Handle Authentication Templates (OTP) ──
        if (campaign.template?.category?.toLowerCase() === "authentication") {
          // Generate a unique OTP for this specific phone number
          const otp = await generateWhatsAppOTPService(
            recipient.mobile_number,
            campaign.template.template_name,
          );

          // 1. Add Body Component with OTP
          components.push({
            type: "body",
            parameters: [{ type: "text", text: otp }],
          });

          // 2. Add Button Component if it exists (Meta requirement for dynamic buttons)
          // Let's check the template components for a dynamic button
          const [[templateComp]] = await db.sequelize.query(
            `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ? AND component_type = 'buttons'`,
            { replacements: [campaign.template_id] },
          );

          if (templateComp && templateComp.text_content) {
            try {
              const buttons = JSON.parse(templateComp.text_content);
              // Look for a URL button with a dynamic parameter
              const dynamicButtonIndex = buttons.findIndex(
                (btn) =>
                  btn.type === "URL" && btn.url && btn.url.includes("{{1}}"),
              );

              if (dynamicButtonIndex !== -1) {
                components.push({
                  type: "button",
                  sub_type: "url",
                  index: String(dynamicButtonIndex),
                  parameters: [{ type: "text", text: otp }],
                });
              }
            } catch (e) {
              console.error("Error parsing buttons for OTP template:", e);
            }
          }
          console.log(
            `🔐 [AUTH-CAMPAIGN] Generated OTP for ${recipient.mobile_number}`,
          );
        }
        // ── Handle Normal Templates ──
        else {
          // Support both Array and Object structure for dynamic_variables
          if (
            typeof dynamicVariables === "object" &&
            !Array.isArray(dynamicVariables) &&
            dynamicVariables !== null
          ) {
            // Object structure: { body: [...], buttons: [...] }
            if (
              Array.isArray(dynamicVariables.body) &&
              dynamicVariables.body.length > 0
            ) {
              components.push({
                type: "body",
                parameters: dynamicVariables.body.map((v) => ({
                  type: "text",
                  text: String(v),
                })),
              });
            }

            if (Array.isArray(dynamicVariables.buttons)) {
              dynamicVariables.buttons.forEach((btn, idx) => {
                if (btn && btn.parameters && btn.parameters.length > 0) {
                  components.push({
                    type: "button",
                    sub_type: "url",
                    index: String(btn.index !== undefined ? btn.index : idx),
                    parameters: btn.parameters.map((p) => ({
                      type: "text",
                      text: String(p),
                    })),
                  });
                }
              });
            }
          } else if (
            Array.isArray(dynamicVariables) &&
            dynamicVariables.length > 0
          ) {
            // Legacy Array support: Treat everything as Body parameters
            components.push({
              type: "body",
              parameters: dynamicVariables.map((v) => ({
                type: "text",
                text: String(v),
              })),
            });
          }
        }

        // 2. Add Header Component (Media or Location)
        if (headerComponent) {
          const hFormat = headerComponent.header_format?.toUpperCase();
          if (
            ["IMAGE", "VIDEO", "DOCUMENT"].includes(hFormat) &&
            campaignHeaderMediaUrl
          ) {
            const mediaObj = { link: campaignHeaderMediaUrl };
            if (hFormat === "DOCUMENT") {
              mediaObj.filename = campaign.header_file_name || "document.pdf";
            }
            components.push({
              type: "header",
              parameters: [
                {
                  type: hFormat.toLowerCase(),
                  [hFormat.toLowerCase()]: mediaObj,
                },
              ],
            });
          }
          // Location header: send location params inside the template header
          else if (hFormat === "LOCATION" && campaignLocationParams) {
            components.push({
              type: "header",
              parameters: [
                {
                  type: "location",
                  location: {
                    latitude: Number(campaignLocationParams.latitude),
                    longitude: Number(campaignLocationParams.longitude),
                    name: campaignLocationParams.name || "",
                    address: campaignLocationParams.address || "",
                  },
                },
              ],
            });
          }
        }

        // 3. Add Carousel Component
        const [templateType] = await db.sequelize.query(
          `SELECT category FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ?`,
          { replacements: [campaign.template_id] },
        );

        // Fetch full template to check for carousel (since template record doesn't store 'carousel' as category)
        // We actually need to check if there are CAROUSEL components
        const [carousel_data] = await db.sequelize.query(
          `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ? AND component_type = 'CAROUSEL'`,
          { replacements: [campaign.template_id] },
        );

        if (carousel_data.length > 0 && campaignCardMediaUrls) {
          try {
            const carouselComp = JSON.parse(carousel_data[0].text_content);
            if (carouselComp.cards && Array.isArray(carouselComp.cards)) {
              const cardsPayload = carouselComp.cards.map((card, idx) => {
                const cardComponents = [];
                const cardMediaUrl = campaignCardMediaUrls[idx];

                // Find if this card has a header that needs media
                const cardHeader = card.components?.find(
                  (c) => c.type === "HEADER",
                );
                if (
                  cardHeader &&
                  (cardHeader.format === "IMAGE" ||
                    cardHeader.format === "VIDEO") &&
                  cardMediaUrl
                ) {
                  cardComponents.push({
                    type: "header",
                    parameters: [
                      {
                        type: cardHeader.format.toLowerCase(),
                        [cardHeader.format.toLowerCase()]: {
                          link: cardMediaUrl,
                        },
                      },
                    ],
                  });
                }

                // Carousel cards can also have body variables if needed,
                // but our current frontend implementation handles global variables.
                // Meta allows 'body' in carousel card components if the template defines them.

                return {
                  index: idx,
                  components: cardComponents,
                };
              });

              components.push({
                type: "carousel",
                cards: cardsPayload,
              });
            }
          } catch (e) {
            console.error(
              "Error parsing carousel component for campaign execution:",
              e,
            );
          }
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
          error_message: null, // Clear any previous error
        });

        // 3. Log to Message History and Activate Live Chat
        if (contactId && result.meta_message_id) {
          let personalizedMessage = templateBodyText;

          // Handle variable replacement for both array and object structures
          let bodyVars = [];
          if (Array.isArray(dynamicVariables) && dynamicVariables.length > 0) {
            bodyVars = dynamicVariables;
          } else if (
            typeof dynamicVariables === "object" &&
            dynamicVariables !== null &&
            Array.isArray(dynamicVariables.body)
          ) {
            bodyVars = dynamicVariables.body;
          }

          if (bodyVars.length > 0) {
            bodyVars.forEach((val, idx) => {
              personalizedMessage = personalizedMessage.replace(
                `{{${idx + 1}}}`,
                val,
              );
            });
          }

          // Determine message type and media URL based on header format
          let finalMessageType = "template";
          let finalMediaUrl = null;

          if (
            headerFormat &&
            ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat.toUpperCase())
          ) {
            finalMessageType = headerFormat.toLowerCase();
            finalMediaUrl = campaignHeaderMediaUrl || null;

            // Prepend media marker to message content for proper rendering in chat view
            if (finalMediaUrl) {
              personalizedMessage = `[${headerFormat.toUpperCase()}: ${finalMediaUrl}]\n${personalizedMessage}`;
            } else {
              personalizedMessage = `[${headerFormat.toUpperCase()}]\n${personalizedMessage}`;
            }
          }

          // Append footer text if present
          if (footerComponent?.text_content) {
            personalizedMessage += "\n" + footerComponent.text_content;
          }

          // Append button markers for chat display
          if (buttonsComponent?.text_content) {
            try {
              const buttons = JSON.parse(buttonsComponent.text_content);
              if (Array.isArray(buttons)) {
                buttons.forEach((btn) => {
                  let btnLabel = btn.text;
                  if (btn.type === 'URL' && btn.url) {
                    btnLabel += ` (${btn.url})`;
                  } else if (btn.type === 'PHONE_NUMBER' && btn.phone_number) {
                    btnLabel += ` (${btn.phone_number})`;
                  }
                  personalizedMessage += `\n[Button: ${btnLabel}]`;
                });
              }
            } catch (e) {
              // Silently fail if JSON parsing fails
            }
          }

          // Derive MIME type from filename for document campaigns
          let campaignMediaMimeType = null;
          if (finalMessageType === "document" && campaign.header_file_name) {
            const ext = campaign.header_file_name.split('.').pop()?.toLowerCase();
            const mimeMap = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
            campaignMediaMimeType = mimeMap[ext] || 'application/octet-stream';
          }

          // 6. Log to Messages Table
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
            finalMessageType,
            finalMediaUrl,
            campaignMediaMimeType,
            "sent",
            campaign.template.template_name,
            finalMessageType === "document" ? (campaign.header_file_name || null) : null,
          );

          // 7. Activate Live Chat
          const livelist = await getLivechatByIdService(tenant_id, contactId);
          if (!livelist) {
            await createLiveChatService(tenant_id, contactId);
          } else {
            await updateLiveChatTimestampService(tenant_id, contactId);
          }
        }
      } catch (err) {
        console.error(
          `Failed to send campaign message to ${recipient.mobile_number}:`,
          err.message,
        );
        await recipient.update({
          status: "failed",
          error_message: err.message,
        });
      }
    }

    return { finished: false, processedCount: recipients.length };
  } catch (err) {
    throw err;
  }
};

/**
 * Soft delete a campaign and its recipients
 */
export const softDeleteCampaignService = async (campaign_id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    const campaign = await db.WhatsappCampaigns.findOne({
      where: { campaign_id, tenant_id, is_deleted: false },
      transaction,
    });

    if (!campaign) {
      throw new Error("Campaign not found");
    }

    // Soft delete the campaign
    await campaign.update(
      {
        is_deleted: true,
        deleted_at: new Date(),
      },
      { transaction },
    );

    // Soft delete all recipients
    await db.WhatsappCampaignRecipients.update(
      {
        is_deleted: true,
        deleted_at: new Date(),
      },
      {
        where: { campaign_id },
        transaction,
      },
    );

    await transaction.commit();
    return { message: "Campaign and recipients soft deleted successfully" };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

/**
 * Permanently delete a campaign and its recipients
 */
export const permanentDeleteCampaignService = async (
  campaign_id,
  tenant_id,
) => {
  const transaction = await db.sequelize.transaction();
  try {
    const campaign = await db.WhatsappCampaigns.findOne({
      where: { campaign_id, tenant_id },
    });

    if (!campaign) {
      throw new Error("Campaign not found");
    }

    // Delete all recipients first
    await db.WhatsappCampaignRecipients.destroy({
      where: { campaign_id },
      transaction,
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
        await executeCampaignBatchService(
          campaign.campaign_id,
          campaign.tenant_id,
          100,
        );
      }
    } catch (err) {
      console.error("Campaign Scheduler Error:", err.message);
    }
  });
};

/**
 * Retrieves a list of deleted campaigns for a tenant with filtering.
 */
export const getDeletedCampaignListService = async (tenant_id) => {
  try {
    const where = { tenant_id, is_deleted: true };

    const rows = await db.WhatsappCampaigns.findAll({
      where,
      order: [["deleted_at", "DESC"]],
      include: [
        {
          model: db.WhatsappTemplates,
          as: "template",
          attributes: ["template_name", "category", "language"],
        },
      ],
    });

    return {
      campaigns: rows,
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Restore a soft-deleted campaign
 */
export const restoreCampaignService = async (campaign_id, tenant_id) => {
  try {
    const campaign = await db.WhatsappCampaigns.findOne({
      where: { campaign_id, tenant_id, is_deleted: true },
    });

    if (!campaign) {
      throw new Error("Campaign not found or not deleted");
    }

    await campaign.update({
      is_deleted: false,
      deleted_at: null,
    });

    return { message: "Campaign restored successfully" };
  } catch (err) {
    throw err;
  }
};
