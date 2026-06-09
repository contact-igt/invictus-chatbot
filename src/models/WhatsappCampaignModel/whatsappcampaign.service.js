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
import {
  isCampaignQueueAvailable,
  getCampaignDispatchQueue,
} from "../../queues/campaignQueue.js";
import { addCampaignUsageService } from "../GalleryModel/gallery.service.js";
import { logger } from "../../utils/logger.js";
import { recordCampaignDiagnosticEvent } from "../../utils/campaignDiagnosticsEvents.js";

// In-memory lock to prevent concurrent batch executions for the same campaign
const runningCampaigns = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getUniquePlaceholderCount = (text = "") => {
  return (String(text).match(/{{\d+}}/g) || []).reduce(
    (set, placeholder) => set.add(placeholder),
    new Set(),
  ).size;
};

const parseTemplateButtons = (buttonsContent) => {
  if (!buttonsContent) return [];

  try {
    const parsed =
      typeof buttonsContent === "string"
        ? JSON.parse(buttonsContent)
        : buttonsContent;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getTemplateVariableRequirements = async (template_id) => {
  const [components] = await db.sequelize.query(
    `SELECT component_type, text_content, header_format
     FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
     WHERE template_id = ? AND component_type IN ('body', 'buttons', 'header')`,
    { replacements: [template_id] },
  );

  const bodyComponent = components.find((c) => c.component_type === "body");
  const buttonsComponent = components.find(
    (c) => c.component_type === "buttons",
  );
  const headerComponent = components.find((c) => c.component_type === "header");
  const buttonVariables = parseTemplateButtons(buttonsComponent?.text_content)
    .map((button, index) => ({ button, index }))
    .filter(
      ({ button }) =>
        button?.type === "URL" &&
        typeof button?.url === "string" &&
        button.url.includes("{{1}}"),
    )
    .map(({ index }) => ({ index }));

  return {
    expectedBodyCount: getUniquePlaceholderCount(bodyComponent?.text_content),
    buttonVariables,
    headerFormat: String(headerComponent?.header_format || "").toUpperCase(),
  };
};

const normalizeRecipientDynamicVariables = (dynamicVariables, requirements) => {
  let parsedDynamicVariables = dynamicVariables;

  if (typeof parsedDynamicVariables === "string") {
    try {
      parsedDynamicVariables = JSON.parse(parsedDynamicVariables);
    } catch {
      return parsedDynamicVariables;
    }
  }

  if (
    Array.isArray(parsedDynamicVariables) &&
    requirements.buttonVariables.length > 0
  ) {
    const body = parsedDynamicVariables.slice(
      0,
      requirements.expectedBodyCount,
    );
    const buttons = requirements.buttonVariables.map(
      (buttonVariable, offset) => ({
        index: buttonVariable.index,
        parameters: [
          parsedDynamicVariables[requirements.expectedBodyCount + offset] || "",
        ],
      }),
    );

    return { body, buttons };
  }

  return parsedDynamicVariables;
};

const getRecipientVariableState = (dynamicVariables) => {
  const result = {
    bodyCount: 0,
    buttonCount: 0,
    hasEmptyValues: false,
  };

  if (Array.isArray(dynamicVariables)) {
    result.bodyCount = dynamicVariables.length;
    result.hasEmptyValues = dynamicVariables.some(
      (value) => !String(value ?? "").trim(),
    );
    return result;
  }

  if (!dynamicVariables || typeof dynamicVariables !== "object") {
    return result;
  }

  if (Array.isArray(dynamicVariables.body)) {
    result.bodyCount = dynamicVariables.body.length;
    result.hasEmptyValues = dynamicVariables.body.some(
      (value) => !String(value ?? "").trim(),
    );
  }

  if (Array.isArray(dynamicVariables.buttons)) {
    result.buttonCount = dynamicVariables.buttons.filter(
      (button) =>
        Array.isArray(button?.parameters) && button.parameters.length > 0,
    ).length;

    if (!result.hasEmptyValues) {
      result.hasEmptyValues = dynamicVariables.buttons.some(
        (button) =>
          !Array.isArray(button?.parameters) ||
          button.parameters.some((value) => !String(value ?? "").trim()),
      );
    }
  }

  return result;
};

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
      media_asset_id, // Gallery asset ID (optional)
      media_handle, // Meta media handle from gallery (optional)
    } = data;
    const normalizedCampaignType = String(campaign_type || "")
      .trim()
      .toLowerCase();
    const scheduledAtUtc =
      normalizedCampaignType === "scheduled" && scheduled_at
        ? new Date(new Date(scheduled_at).toISOString())
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
      attributes: ["template_id", "status", "category"],
    });
    if (!template) {
      throw new Error("Template not found");
    }
    if (String(template.status || "").toLowerCase() !== "approved") {
      throw new Error(
        "Only approved templates can be used to create campaigns",
      );
    }

    // Block campaign send if media is soft-deleted or handle expired
    if (media_asset_id) {
      const mediaAsset = await db.MediaAsset.findOne({
        where: { media_asset_id, tenant_id },
      });
      if (!mediaAsset) {
        throw new Error("The media attached to this template does not exist.");
      }
      if (mediaAsset.is_deleted) {
        const err = new Error(
          "The media attached to this template has been deleted. Please update the template with active media before sending.",
        );
        err.error_code = "MEDIA_DELETED";
        throw err;
      }
      if (
        mediaAsset.handle_expires_at &&
        new Date(mediaAsset.handle_expires_at) < new Date()
      ) {
        throw new Error(
          "Media handle has expired. Please re-upload the file and update the template.",
        );
      }
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
          if (!formatted || seenNumbers.has(formatted)) return null;
          seenNumbers.add(formatted);
          return {
            mobile_number: formatted,
            contact_id: item.contact_id || null,
            dynamic_variables: item.dynamic_variables || null,
          };
        })
        .filter((r) => r && r.mobile_number);

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
            if (!formatted || seenNumbers.has(formatted)) return null;
            seenNumbers.add(formatted);
            return {
              mobile_number: formatted,
              contact_id: item.contact_id || null,
              dynamic_variables: item.dynamic_variables || null,
            };
          })
          .filter((r) => r && r.mobile_number);

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

        // Format and deduplicate exactly like manual/csv paths
        const groupSeenNumbers = new Set();
        recipients = groupMembers
          .map((member) => {
            const formatted = formatPhoneNumber(member.contact.phone);
            if (!formatted || groupSeenNumbers.has(formatted)) return null;
            groupSeenNumbers.add(formatted);
            return {
              mobile_number: formatted,
              contact_id: member.contact.contact_id,
              dynamic_variables: null,
            };
          })
          .filter((r) => r && r.mobile_number);

        if (recipients.length === 0) {
          throw new Error(
            "No valid phone numbers found in group. All members may have invalid or missing numbers.",
          );
        }
      }
    } else {
      throw new Error(
        "Invalid audience_type. Must be 'manual', 'group', or 'csv'",
      );
    }

    if (String(template.category || "").toLowerCase() !== "authentication") {
      const variableRequirements =
        await getTemplateVariableRequirements(template_id);
      const expectedButtonCount = variableRequirements.buttonVariables.length;

      recipients = recipients.map((recipient) => ({
        ...recipient,
        dynamic_variables: normalizeRecipientDynamicVariables(
          recipient.dynamic_variables,
          variableRequirements,
        ),
      }));

      if (
        variableRequirements.expectedBodyCount > 0 ||
        expectedButtonCount > 0
      ) {
        recipients.forEach((recipient) => {
          const { bodyCount, buttonCount, hasEmptyValues } =
            getRecipientVariableState(recipient.dynamic_variables);

          if (
            bodyCount !== variableRequirements.expectedBodyCount ||
            buttonCount !== expectedButtonCount ||
            hasEmptyValues
          ) {
            throw new Error(
              `Template variable mismatch for ${recipient.mobile_number}. Expected ${variableRequirements.expectedBodyCount} body and ${expectedButtonCount} button variable(s), but received ${bodyCount} body and ${buttonCount} button variable(s).`,
            );
          }
        });
      }

      if (
        ["IMAGE", "VIDEO", "DOCUMENT"].includes(
          variableRequirements.headerFormat,
        ) &&
        !header_media_url &&
        !media_handle
      ) {
        throw new Error(
          `Template header requires ${variableRequirements.headerFormat.toLowerCase()} media, but no media URL or handle was provided.`,
        );
      }

      if (header_media_url) {
        try {
          new URL(header_media_url);
        } catch {
          throw new Error("header_media_url must be a valid URL");
        }
      }

      if (variableRequirements.headerFormat === "LOCATION") {
        const hasLocationParams =
          location_params?.latitude &&
          location_params?.longitude &&
          location_params?.name &&
          location_params?.address;

        if (!hasLocationParams) {
          throw new Error(
            "Template header requires location_params with latitude, longitude, name, and address.",
          );
        }
      }
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
        status: normalizedCampaignType === "scheduled" ? "scheduled" : "active",
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

    // Attach quick aggregates for sent/failed counts to the returned campaign
    if (campaign) {
      try {
        const [countsRow] = await db.sequelize.query(
          `SELECT 
             SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) as sent_count,
             SUM(CASE WHEN status = 'permanently_failed' THEN 1 ELSE 0 END) as failed_count
           FROM whatsapp_campaign_recipients
           WHERE campaign_id = :campaign_id`,
          {
            replacements: { campaign_id },
            type: db.sequelize.QueryTypes.SELECT,
          },
        );

        const sent_count = Number(countsRow?.sent_count || 0);
        const failed_count = Number(countsRow?.failed_count || 0);

        // Attach to dataValues so controller/JSON serialization includes them
        campaign.dataValues = campaign.dataValues || {};
        campaign.dataValues.sent_count = sent_count;
        campaign.dataValues.failed_count = failed_count;
      } catch (e) {
        // ignore aggregation errors — don't fail the whole request for stats
        console.error(
          "[CAMPAIGN-BY-ID] Failed to compute sent/failed aggregates:",
          e.message,
        );
      }
    }

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
        console.error(
          "[CAMPAIGN-CREATE] Failed to log gallery asset usage:",
          err.message,
        ),
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
    const { page, limit, status, search } = query;
    const pageNum = Math.max(1, parseInt(page ?? 1, 10) || 1);
    const limitNum = Math.max(
      1,
      Math.min(100, parseInt(limit ?? 10, 10) || 10),
    );
    const offset = (pageNum - 1) * limitNum;

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
      limit: limitNum,
      offset,
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
      totalPages: Math.ceil(count / limitNum),
      currentPage: pageNum,
    };
  } catch (err) {
    throw err;
  }
};

const buildRecipientStatusWhere = (campaign_id, recipient_status) => {
  const where = { campaign_id };

  if (!recipient_status) {
    return where;
  }

  if (recipient_status === "failed") {
    where.status = {
      [db.Sequelize.Op.in]: ["failed", "permanently_failed"],
    };
    return where;
  }

  where.status = recipient_status;
  return where;
};

const buildRetryEligibleRecipientWhere = (campaign_id, now = new Date()) => ({
  campaign_id,
  is_deleted: false,
  [db.Sequelize.Op.or]: [
    { status: "pending" },
    {
      status: "failed",
      retry_count: { [db.Sequelize.Op.lt]: 3 },
      next_retry_at: { [db.Sequelize.Op.lte]: now },
    },
  ],
});

const buildOutstandingRecipientWhere = (campaign_id) => ({
  campaign_id,
  is_deleted: false,
  [db.Sequelize.Op.or]: [
    { status: "pending" },
    {
      status: "failed",
      retry_count: { [db.Sequelize.Op.lt]: 3 },
      next_retry_at: { [db.Sequelize.Op.ne]: null },
    },
  ],
});

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
    const recipientWhere = buildRecipientStatusWhere(
      campaign_id,
      recipient_status,
    );

    const campaign = await db.WhatsappCampaigns.findOne({
      where: { campaign_id, tenant_id },
      include: [
        {
          model: db.WhatsappTemplates,
          as: "template",
          required: false,
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

const escapeCsvValue = (value) => {
  if (value === null || value === undefined) return "";

  let normalizedValue = value;

  if (typeof normalizedValue === "object") {
    try {
      normalizedValue = JSON.stringify(normalizedValue);
    } catch {
      normalizedValue = String(normalizedValue);
    }
  }

  const stringValue = String(normalizedValue);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
};

export const exportCampaignRecipientsCsvService = async (
  campaign_id,
  tenant_id,
  recipient_status,
) => {
  const campaign = await db.WhatsappCampaigns.findOne({
    where: { campaign_id, tenant_id, is_deleted: false },
    attributes: ["campaign_id", "campaign_name"],
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const where = buildRecipientStatusWhere(campaign_id, recipient_status);

  const recipients = await db.WhatsappCampaignRecipients.findAll({
    where,
    attributes: [
      "mobile_number",
      "status",
      "dynamic_variables",
      "meta_message_id",
      "error_message",
      "createdAt",
      "updatedAt",
    ],
    order: [["id", "ASC"]],
  });

  const headers = [
    "mobile_number",
    "status",
    "dynamic_variables",
    "meta_message_id",
    "error_message",
    "created_at",
    "updated_at",
  ];

  const rows = recipients.map((recipient) => {
    const dynamicVariables = Array.isArray(recipient.dynamic_variables)
      ? recipient.dynamic_variables.join(" | ")
      : recipient.dynamic_variables;

    return [
      recipient.mobile_number,
      recipient.status,
      dynamicVariables,
      recipient.meta_message_id,
      recipient.error_message,
      recipient.createdAt ? new Date(recipient.createdAt).toISOString() : "",
      recipient.updatedAt ? new Date(recipient.updatedAt).toISOString() : "",
    ]
      .map(escapeCsvValue)
      .join(",");
  });

  const safeCampaignName = String(campaign.campaign_name || campaign_id)
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  const normalizedStatus = recipient_status || "all";
  const fileName = `${safeCampaignName || campaign_id}-${normalizedStatus}.csv`;
  const csv = [headers.join(","), ...rows].join("\n");

  return {
    fileName,
    csv,
    total: recipients.length,
  };
};

/**
 * Processes a batch of pending recipients for an active campaign.
 */
export const executeCampaignBatchService = async (
  campaign_id,
  tenant_id,
  batchSize = 15,
) => {
  throw new Error(
    "executeCampaignBatchService is not implemented in this build. Please restore the function body.",
  );
};
