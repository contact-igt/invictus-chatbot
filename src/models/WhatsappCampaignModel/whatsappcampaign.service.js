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
import { canSendCampaign } from "../../utils/billing/walletGuard.js";
import { estimateMetaCost } from "../../utils/billing/costEstimator.js";
import { addCampaignUsageService } from "../GalleryModel/gallery.service.js";

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
      media_asset_id,  // Gallery asset ID (optional)
      media_handle,    // Meta media handle from gallery (optional)
    } = data;
    const scheduledAtUtc =
      campaign_type === "scheduled" && scheduled_at
        ? new Date(scheduled_at).toISOString()
        : null;

    // 0. Check for duplicate campaign name
    const existingCampaign = await db.WhatsappCampaigns.findOne({
      where: { tenant_id, campaign_name, is_deleted: false },
    });

    if (existingCampaign) {
      throw new Error(
        `A campaign with the name "${campaign_name}" already exists.`,
      );
    }

    // Campaigns can only run with templates that are approved and active for this tenant
    const template = await db.WhatsappTemplates.findOne({
      where: { template_id, tenant_id, is_deleted: false },
      attributes: ["template_id", "status"],
    });
    if (!template) {
      throw new Error("Template not found");
    }
    if (String(template.status || "").toLowerCase() !== "approved") {
      throw new Error("Only approved templates can be used to create campaigns");
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

    // Tier limits are WABA-level (portfolio), shared across all phone numbers.
    // Counted as unique users (by contact_id) per 24h, not total messages.
    const tierLimits = {
      TIER_NOT_SET: 250,
      TIER_2K: 2000,
      TIER_10K: 10000,
      TIER_100K: 100000,
      TIER_UNLIMITED: Infinity,
    };
    const limit = tierLimits[account.tier] ?? 250;

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
        status: campaign_type === "scheduled" ? "scheduled" : "active",
        total_audience: recipients.length,
        scheduled_at: scheduledAtUtc,
        header_media_url,
        header_file_name,
        location_params,
        card_media_urls,
        media_asset_id: media_asset_id || null,
        media_handle: media_handle || null,
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

    // 5. Track gallery asset usage (fire and forget, after commit)
    if (media_asset_id) {
      addCampaignUsageService(media_asset_id, campaign_id).catch((err) =>
        console.error("[CAMPAIGN-CREATE] Failed to log gallery asset usage:", err.message)
      );
    }

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
    const { page = 1, limit = 10, status, search } = query;
    const offset = (page - 1) * limit;

    const where = { tenant_id, is_deleted: false };
    if (status) {
      where.status = status === "running" ? "active" : status;
    }
    if (search) {
      where.campaign_name = {
        [db.Sequelize.Op.like]: `%${search}%`,
      };
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
      where: {
        campaign_id,
        tenant_id,
        status: { [db.Sequelize.Op.in]: ["active", "scheduled", "paused"] },
      },
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

    // --- Per-batch billing check: estimate cost for this batch ---
    try {
      const category = (
        campaign.template?.category || "marketing"
      ).toLowerCase();
      const tenantForBilling = await db.Tenants.findOne({
        where: { tenant_id },
        attributes: ["country", "owner_country_code", "timezone"],
        raw: true,
      });
      const isIndia =
        tenantForBilling?.owner_country_code === "91" ||
        tenantForBilling?.timezone === "Asia/Kolkata";
      const billingCountry =
        tenantForBilling?.country || (isIndia ? "IN" : "Global");
      const cost = await estimateMetaCost(category, billingCountry);
      const batchCost = cost.totalCostInr * recipients.length;
      const billingCheck = await canSendCampaign(tenant_id, batchCost);

      if (!billingCheck.allowed) {
        console.warn(
          `[CAMPAIGN-BILLING] Campaign ${campaign_id} paused — ${billingCheck.reason}`,
        );
        await campaign.update({ status: "paused" });
        return {
          finished: true,
          paused: true,
          reason: billingCheck.reason,
        };
      }
    } catch (billingErr) {
      console.error(
        `[CAMPAIGN-BILLING] Check failed for campaign ${campaign_id}:`,
        billingErr.message,
      );
      // Fail open — don't block on billing check error
    }

    // Update campaign status to active if it was scheduled, draft, or paused
    if (
      campaign.status === "scheduled" ||
      campaign.status === "draft" ||
      campaign.status === "paused"
    ) {
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
          const mediaHandle = campaign.media_handle;
          const mediaId =
            mediaHandle && /^[0-9]+$/.test(String(mediaHandle))
              ? String(mediaHandle)
              : null;
          
          if (
            ["IMAGE", "VIDEO", "DOCUMENT"].includes(hFormat) &&
            (mediaHandle || campaignHeaderMediaUrl)
          ) {
            let mediaObj = null;
            if (mediaId) {
              mediaObj = { id: mediaId };
            } else if (campaignHeaderMediaUrl) {
              mediaObj = { link: campaignHeaderMediaUrl };
            } else {
              throw new Error(
                "Media header is configured, but no valid media ID or preview URL is available for sending.",
              );
            }

            // If media_handle exists but is not a valid Meta media ID, use link flow.
            if (mediaHandle && !mediaId && campaignHeaderMediaUrl) {
              console.warn(
                `[CAMPAIGN-SEND] media_handle is not a valid Meta media ID for ${campaign_id}. Falling back to link.`,
              );
            }
             
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
                    latitude: String(campaignLocationParams.latitude),
                    longitude: String(campaignLocationParams.longitude),
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

        let result;
        try {
          result = await sendWhatsAppTemplate(
            tenant_id,
            recipient.mobile_number,
            campaign.template.template_name,
            campaign.template.language,
            components,
          );
        } catch (sendErr) {
          const errMsg = String(sendErr?.message || "");
          const hasInvalidMediaId =
            errMsg.includes("is not a valid whatsapp business account media attachment ID") ||
            errMsg.includes("template['components'][0]['parameters'][0]['image']['id']");

          // Auto-retry once with LINK if Meta rejects the media ID and we have a preview URL.
          if (hasInvalidMediaId && campaignHeaderMediaUrl) {
            const retryComponents = components.map((component) => {
              if (component?.type !== "header" || !Array.isArray(component.parameters)) {
                return component;
              }
              const nextParams = component.parameters.map((param) => {
                if (!param || typeof param !== "object") return param;
                if (param.type === "image" && param.image?.id) {
                  return { ...param, image: { link: campaignHeaderMediaUrl } };
                }
                if (param.type === "video" && param.video?.id) {
                  return { ...param, video: { link: campaignHeaderMediaUrl } };
                }
                if (param.type === "document" && param.document?.id) {
                  return {
                    ...param,
                    document: {
                      link: campaignHeaderMediaUrl,
                      ...(campaign.header_file_name
                        ? { filename: campaign.header_file_name }
                        : {}),
                    },
                  };
                }
                return param;
              });
              return { ...component, parameters: nextParams };
            });

            console.warn(
              `[CAMPAIGN-SEND] Invalid media id for campaign ${campaign_id}. Retrying with link.`,
            );
            result = await sendWhatsAppTemplate(
              tenant_id,
              recipient.mobile_number,
              campaign.template.template_name,
              campaign.template.language,
              retryComponents,
            );
          } else {
            throw sendErr;
          }
        }

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
                  if (btn.type === "URL" && btn.url) {
                    btnLabel += ` (${btn.url})`;
                  } else if (btn.type === "PHONE_NUMBER" && btn.phone_number) {
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
            const ext = campaign.header_file_name
              .split(".")
              .pop()
              ?.toLowerCase();
            const mimeMap = {
              pdf: "application/pdf",
              doc: "application/msword",
              docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              xls: "application/vnd.ms-excel",
              xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            };
            campaignMediaMimeType = mimeMap[ext] || "application/octet-stream";
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
            finalMessageType === "document"
              ? campaign.header_file_name || null
              : null,
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
        const currentRetryCount = Number(recipient.retry_count || 0);
        const nextRetryCount = currentRetryCount + 1;
        const backoffMinutes = nextRetryCount === 1 ? 5 : nextRetryCount === 2 ? 15 : 45;
        const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

        await recipient.update({
          status: nextRetryCount >= 3 ? "permanently_failed" : "failed",
          error_message: err.message,
          last_error: err.message,
          retry_count: nextRetryCount,
          next_retry_at: nextRetryCount >= 3 ? null : nextRetryAt,
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
          AND scheduled_at <= UTC_TIMESTAMP()
          AND is_deleted = false
      `);

      const activeCampaigns = await db.WhatsappCampaigns.findAll({
        where: { status: "active", is_deleted: false },
      });

      for (const campaign of activeCampaigns) {
        // Pre-execution billing check: verify tenant can afford at least 1 batch
        try {
          const template = await db.WhatsappTemplates.findOne({
            where: { template_id: campaign.template_id },
            attributes: ["category"],
            raw: true,
          });
          const category = (template?.category || "marketing").toLowerCase();
          const tenantForBilling = await db.Tenants.findOne({
            where: { tenant_id: campaign.tenant_id },
            attributes: ["country", "owner_country_code", "timezone"],
            raw: true,
          });
          const isIndia =
            tenantForBilling?.owner_country_code === "91" ||
            tenantForBilling?.timezone === "Asia/Kolkata";
          const billingCountry =
            tenantForBilling?.country || (isIndia ? "IN" : "Global");
          const cost = await estimateMetaCost(category, billingCountry);
          // Estimate cost for a single batch of 100 messages
          const pendingCount = await db.WhatsappCampaignRecipients.count({
            where: { campaign_id: campaign.campaign_id, status: "pending" },
          });
          const batchEstimate = Math.min(pendingCount, 100);
          const batchCost = cost.totalCostInr * batchEstimate;

          const billingCheck = await canSendCampaign(
            campaign.tenant_id,
            batchCost,
          );

          if (!billingCheck.allowed) {
            console.warn(
              `[CAMPAIGN-SCHEDULER] Skipping campaign ${campaign.campaign_id} — ${billingCheck.reason}`,
            );
            await campaign.update({ status: "paused" });
            continue; // Skip this campaign, move to next
          }
        } catch (billingErr) {
          console.error(
            `[CAMPAIGN-SCHEDULER] Billing check error for ${campaign.campaign_id}:`,
            billingErr.message,
          );
          // Fail open — proceed with execution
        }

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

  cron.schedule("*/5 * * * *", async () => {
    try {
      const failedRecipients = await db.WhatsappCampaignRecipients.findAll({
        where: {
          status: "failed",
          is_deleted: false,
          retry_count: { [db.Sequelize.Op.lt]: 3 },
          [db.Sequelize.Op.or]: [
            { next_retry_at: null },
            { next_retry_at: { [db.Sequelize.Op.lte]: new Date() } },
          ],
        },
        limit: 500,
      });

      const campaignIdsToResume = new Set();
      for (const recipient of failedRecipients) {
        await recipient.update({
          status: "pending",
        });
        campaignIdsToResume.add(recipient.campaign_id);
      }

      for (const campaignId of campaignIdsToResume) {
        const campaign = await db.WhatsappCampaigns.findOne({
          where: { campaign_id: campaignId, is_deleted: false },
        });
        if (!campaign) continue;
        if (["paused", "failed", "scheduled"].includes(campaign.status)) {
          await campaign.update({ status: "active" });
        }
        await executeCampaignBatchService(campaignId, campaign.tenant_id, 100);
      }
    } catch (err) {
      console.error("[CAMPAIGN-RETRY-WORKER] Error:", err.message);
    }
  });
};

const normalizeIncomingStatus = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "running") return "active";
  return s;
};

const toTransitionLabel = (status) => {
  if (status === "active") return "running";
  return status;
};

export const updateCampaignStatusService = async (campaign_id, tenant_id, nextStatusRaw) => {
  const campaign = await db.WhatsappCampaigns.findOne({
    where: { campaign_id, tenant_id, is_deleted: false },
  });
  if (!campaign) throw new Error("Campaign not found");

  const current = normalizeIncomingStatus(campaign.status);
  const next = normalizeIncomingStatus(nextStatusRaw);
  const allowed = new Set([
    "draft->scheduled",
    "scheduled->active",
    "active->paused",
    "paused->active",
    "active->completed",
  ]);

  if (next === "cancelled") {
    await campaign.update({ status: "cancelled" });
    return campaign;
  }

  const key = `${current}->${next}`;
  if (!allowed.has(key)) {
    throw new Error(
      `Invalid status transition: ${toTransitionLabel(current)} -> ${toTransitionLabel(next)}`,
    );
  }

  await campaign.update({ status: next });
  return campaign;
};

export const recordCampaignEventService = async (payload = {}) => {
  const campaign_id = payload.campaign_id || payload.campaignId;
  const recipient_id = payload.recipient_id || payload.recipientId;
  const event_type = String(payload.event_type || payload.eventType || "").toLowerCase();
  const meta_message_id = payload.meta_message_id || payload.metaMessageId;

  if (!campaign_id || !["open", "click"].includes(event_type)) {
    throw new Error("campaign_id and valid event_type are required");
  }

  let recipient = null;
  if (recipient_id) {
    recipient = await db.WhatsappCampaignRecipients.findOne({
      where: { id: recipient_id, campaign_id, is_deleted: false },
    });
  } else if (meta_message_id) {
    recipient = await db.WhatsappCampaignRecipients.findOne({
      where: { campaign_id, meta_message_id, is_deleted: false },
    });
  }

  if (!recipient) {
    throw new Error("Recipient not found");
  }

  await db.CampaignEvents.create({
    campaign_id,
    recipient_id: recipient.id,
    event_type,
    occurred_at: new Date(),
  });

  if (event_type === "open" && !recipient.opened_at) {
    await recipient.update({ opened_at: new Date() });
  }
  if (event_type === "click" && !recipient.clicked_at) {
    await recipient.update({ clicked_at: new Date() });
  }

  return { campaign_id, recipient_id: recipient.id, event_type };
};

export const getCampaignStatsService = async (campaign_id, tenant_id) => {
  const campaign = await db.WhatsappCampaigns.findOne({
    where: { campaign_id, tenant_id, is_deleted: false },
  });
  if (!campaign) throw new Error("Campaign not found");

  const total_sent = await db.WhatsappCampaignRecipients.count({
    where: {
      campaign_id,
      is_deleted: false,
      status: { [db.Sequelize.Op.in]: ["sent", "delivered", "read", "replied"] },
    },
  });

  const total_delivered = await db.WhatsappCampaignRecipients.count({
    where: {
      campaign_id,
      is_deleted: false,
      status: { [db.Sequelize.Op.in]: ["delivered", "read", "replied"] },
    },
  });

  const total_opened = await db.WhatsappCampaignRecipients.count({
    where: {
      campaign_id,
      is_deleted: false,
      opened_at: { [db.Sequelize.Op.ne]: null },
    },
  });

  const total_clicked = await db.WhatsappCampaignRecipients.count({
    where: {
      campaign_id,
      is_deleted: false,
      clicked_at: { [db.Sequelize.Op.ne]: null },
    },
  });

  const safeDenominator = total_sent || 1;
  const open_rate = Number(((total_opened / safeDenominator) * 100).toFixed(2));
  const click_rate = Number(((total_clicked / safeDenominator) * 100).toFixed(2));

  return {
    total_sent,
    total_delivered,
    total_opened,
    total_clicked,
    open_rate,
    click_rate,
  };
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
