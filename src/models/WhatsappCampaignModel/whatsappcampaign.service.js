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
import { logger } from "../../utils/logger.js";

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
  const where = { campaign_id, is_deleted: false };

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
  console.log(
    `[CAMPAIGN-BATCH-ENTRY] executeCampaignBatchService called: campaign_id=${campaign_id}, tenant_id=${tenant_id}, batchSize=${batchSize}`,
  );

  if (runningCampaigns.has(campaign_id)) {
    logger.warn(
      `[CAMPAIGN-LOCK] Campaign ${campaign_id} already executing, skipping concurrent run`,
    );
    return { finished: false, skipped: true };
  }
  runningCampaigns.add(campaign_id);
  console.log(
    `[CAMPAIGN-BATCH] Lock acquired for campaign ${campaign_id}. runningCampaigns size: ${runningCampaigns.size}`,
  );

  logger.info(
    `[CAMPAIGN-BATCH] Executing batch for campaign ${campaign_id} (tenant=${tenant_id}, batchSize=${batchSize})`,
  );
  try {
    const campaign = await db.WhatsappCampaigns.findOne({
      where: {
        campaign_id,
        tenant_id,
        status: {
          [db.Sequelize.Op.in]: [
            "draft",
            "active",
            "scheduled",
            "paused",
            "failed",
          ],
        },
      },
      include: [
        {
          model: db.WhatsappTemplates,
          as: "template",
        },
      ],
    });

    console.log(
      `[CAMPAIGN-BATCH] Campaign query result: ${campaign ? `found (status=${campaign.status})` : "NOT FOUND"}`,
    );

    if (!campaign) {
      logger.error(
        `[CAMPAIGN-BATCH] Campaign ${campaign_id} not found or not in executable state`,
      );
      throw new Error("Campaign not found or not in executable state");
    }

    logger.info(
      `[CAMPAIGN-BATCH] Found campaign ${campaign_id} with status=${campaign.status}, template=${campaign.template?.template_name || "N/A"}`,
    );

    const recipients = await db.WhatsappCampaignRecipients.findAll({
      where: { campaign_id, status: "pending" },
      limit: batchSize,
    });

    console.log(
      `[CAMPAIGN-BATCH] Pending recipients query: found ${recipients.length} recipients`,
    );

    logger.info(
      `[CAMPAIGN-BATCH] Found ${recipients.length} pending recipients for campaign ${campaign_id}`,
    );

    if (!campaign.template) {
      console.error(
        `[CAMPAIGN-BATCH] Campaign ${campaign_id} has no template details - marking as failed`,
      );
      await campaign.update({ status: "failed" });
      return { finished: true };
    }

    console.log(
      `[CAMPAIGN-BATCH] Template check passed: ${campaign.template.template_name}`,
    );

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
      await campaign.update({ status: "completed" });
      logger.info(
        `[CAMPAIGN-BATCH] Campaign ${campaign_id} completed — no more pending recipients`,
      );
      return { finished: true };
    }

    logger.info(
      `[CAMPAIGN-BATCH] Starting batch for campaign ${campaign_id} — ${recipients.length} recipients`,
    );

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

    // If the campaign has been paused by the user, respect it — do not auto-activate.
    if (campaign.status === "paused") {
      const pendingCount = await db.WhatsappCampaignRecipients.count({
        where: { campaign_id, status: "pending" },
      });
      logger.info(
        `[CAMPAIGN-BATCH] Campaign ${campaign_id} is paused — skipping execution (${pendingCount} recipients still pending)`,
      );
      return { finished: false, paused: true, pendingCount };
    }

    // Auto-activate if status is still scheduled or draft (scheduler already handles this,
    // but guard here for direct manual triggers)
    if (campaign.status === "scheduled" || campaign.status === "draft") {
      await campaign.update({ status: "active" });
    }

    let batchSentCount = 0;
    let batchFailCount = 0;
    let recipientIndex = 0;

    for (const recipient of recipients) {
      recipientIndex++;
      // Mid-batch pause check every 5 recipients — re-read DB status so user
      // can stop the campaign without waiting for the full batch to finish.
      if (recipientIndex % 5 === 0) {
        const freshCampaign = await db.WhatsappCampaigns.findOne({
          where: { campaign_id },
          attributes: ["status"],
          raw: true,
        });
        if (freshCampaign?.status === "paused") {
          logger.info(
            `[CAMPAIGN-BATCH] Campaign ${campaign_id} paused mid-batch after ${recipientIndex - 1} recipients — stopping`,
          );
          break;
        }
      }
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
          const mediaId = mediaHandle ? String(mediaHandle) : null;

          if (
            ["IMAGE", "VIDEO", "DOCUMENT"].includes(hFormat) &&
            (mediaHandle || campaignHeaderMediaUrl)
          ) {
            let mediaObj = null;

            if (hFormat === "DOCUMENT") {
              // Meta Cloud API schema requires document.id to be [integer, null].
              // The resumable-upload handle ("4::...") is a string and fails that
              // schema check. Always prefer link for documents; only use id when
              // the value is a pure numeric string (a real Media ID).
              const isNumericId = mediaId && /^\d+$/.test(mediaId);
              if (campaignHeaderMediaUrl) {
                mediaObj = { link: campaignHeaderMediaUrl };
              } else if (isNumericId) {
                mediaObj = { id: mediaId };
              } else {
                throw new Error(
                  "Document header requires a public media URL. No valid URL is available for sending.",
                );
              }
              mediaObj.filename = campaign.header_file_name || "document.pdf";
            } else {
              // IMAGE / VIDEO: resumable-upload handles ("4::...") are strings and
              // are only valid for template submission (header_handle field), NOT for
              // sending messages (image.id / video.id require a numeric Media ID).
              // Always prefer the public preview URL (link); fall back to id only
              // when the value is a pure numeric string (a real Media API ID).
              const isNumericId = mediaId && /^\d+$/.test(mediaId);
              if (campaignHeaderMediaUrl) {
                mediaObj = { link: campaignHeaderMediaUrl };
              } else if (isNumericId) {
                mediaObj = { id: mediaId };
              } else {
                throw new Error(
                  `${hFormat} header requires a public media URL. No valid URL is available for sending.`,
                );
              }
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
          `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id = ? AND component_type = 'carousel'`,
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

        // ── Pre-send validation ─────────────────────────────────────────────
        // Step 1: Validate phone number format
        const formattedPhone = formatPhoneNumber(recipient.mobile_number);
        if (!formattedPhone) {
          throw Object.assign(
            new Error(
              `Invalid phone number "${recipient.mobile_number}" — must be 10–15 digits with country code (e.g. 919876543210)`,
            ),
            { validation: true, permanent: true },
          );
        }

        // Step 2: Validate template variable count
        const expectedVarCount = (
          templateBodyText.match(/{{\d+}}/g) || []
        ).reduce((set, m) => set.add(m), new Set()).size;
        if (expectedVarCount > 0) {
          let sentVarCount = 0;
          if (
            typeof dynamicVariables === "object" &&
            !Array.isArray(dynamicVariables) &&
            Array.isArray(dynamicVariables.body)
          ) {
            sentVarCount = dynamicVariables.body.length;
          } else if (Array.isArray(dynamicVariables)) {
            sentVarCount = dynamicVariables.length;
          }
          if (sentVarCount < expectedVarCount) {
            throw Object.assign(
              new Error(
                `Variable mismatch found — template expects ${expectedVarCount} variable(s) but recipient has ${sentVarCount}. ` +
                  `mobile_number=${recipient.mobile_number} template_id=${campaign.template_id}`,
              ),
              { validation: true, permanent: true },
            );
          }
        }

        // Step 3: Validate media if template has a media header
        if (
          headerComponent &&
          ["IMAGE", "VIDEO", "DOCUMENT"].includes(
            headerComponent.header_format?.toUpperCase(),
          )
        ) {
          const hasUrl = !!campaignHeaderMediaUrl;
          const hasNumericId =
            campaign.media_handle &&
            /^\d+$/.test(String(campaign.media_handle));
          if (!hasUrl && !hasNumericId) {
            throw Object.assign(
              new Error(
                `Missing media — template header requires ${headerComponent.header_format} but no valid URL or media ID is available for campaign ${campaign_id}`,
              ),
              { validation: true, permanent: false },
            );
          }
        }
        // ── End of pre-send validation ──────────────────────────────────────

        logger.info(
          `[CAMPAIGN-BATCH] Sending to ${formattedPhone} (campaign=${campaign_id} template=${campaign.template_id})`,
        );

        let result;
        // Atomic check: skip if another execution already claimed this recipient
        const stillPending = await db.WhatsappCampaignRecipients.findOne({
          where: { id: recipient.id, status: "pending" },
          attributes: ["id"],
        });
        if (!stillPending) continue;

        try {
          result = await sendWhatsAppTemplate(
            tenant_id,
            formattedPhone,
            campaign.template.template_name,
            campaign.template.language,
            components,
          );
        } catch (sendErr) {
          const errMsg = String(sendErr?.message || "");

          // --- Unhealthy API: pause 30s then retry once ---
          const isUnhealthy =
            errMsg.toLowerCase().includes("unhealthy") ||
            errMsg.toLowerCase().includes("service unavailable") ||
            errMsg.toLowerCase().includes("503");

          if (isUnhealthy) {
            logger.warn(
              `[CAMPAIGN-BATCH] Unhealthy API response for campaign ${campaign_id} — pausing 30s before retry (recipient=${formattedPhone})`,
            );
            await sleep(30000);
            logger.info(
              `[CAMPAIGN-BATCH] Retrying ${formattedPhone} after unhealthy pause`,
            );
            try {
              result = await sendWhatsAppTemplate(
                tenant_id,
                formattedPhone,
                campaign.template.template_name,
                campaign.template.language,
                components,
              );
            } catch (retryErr) {
              logger.error(
                `[CAMPAIGN-BATCH] Retry after unhealthy failed for ${formattedPhone}: ${retryErr.message}`,
              );
              throw retryErr;
            }
          }

          // --- Invalid media ID: retry once with public URL ---
          else {
            const hasInvalidMediaId =
              errMsg.includes(
                "is not a valid whatsapp business account media attachment ID",
              ) ||
              errMsg.includes(
                "template['components'][0]['parameters'][0]['image']['id']",
              ) ||
              (errMsg.includes("JSON schema constraint") &&
                errMsg.includes(".id"));

            if (hasInvalidMediaId && campaignHeaderMediaUrl) {
              const retryComponents = components.map((component) => {
                if (
                  component?.type !== "header" ||
                  !Array.isArray(component.parameters)
                ) {
                  return component;
                }
                const nextParams = component.parameters.map((param) => {
                  if (!param || typeof param !== "object") return param;
                  if (param.type === "image" && param.image?.id) {
                    return {
                      ...param,
                      image: { link: campaignHeaderMediaUrl },
                    };
                  }
                  if (param.type === "video" && param.video?.id) {
                    return {
                      ...param,
                      video: { link: campaignHeaderMediaUrl },
                    };
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

              logger.warn(
                `[CAMPAIGN-BATCH] Invalid media id for campaign ${campaign_id} — retrying with link (recipient=${formattedPhone})`,
              );
              result = await sendWhatsAppTemplate(
                tenant_id,
                formattedPhone,
                campaign.template.template_name,
                campaign.template.language,
                retryComponents,
              );
            } else {
              throw sendErr;
            }
          }
        }

        await recipient.update({
          status: "sent",
          meta_message_id: result.meta_message_id || null,
          error_message: null,
        });
        batchSentCount++;

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
        batchFailCount++;

        // Build a structured diagnostic context for every failure
        const diagContext = {
          mobile_number: recipient.mobile_number,
          template_id: campaign.template_id,
          template_name: campaign.template?.template_name,
          dynamic_variables: (() => {
            try {
              return JSON.stringify(
                dynamicVariables ?? recipient.dynamic_variables,
              );
            } catch {
              return String(dynamicVariables ?? recipient.dynamic_variables);
            }
          })(),
          header_format: headerComponent?.header_format ?? null,
          media_url: campaignHeaderMediaUrl ?? null,
          media_handle: campaign.media_handle ?? null,
          error: err.message,
        };

        // Validation errors (bad phone, variable mismatch, missing media) are permanent —
        // retrying them will never succeed, so mark immediately as permanently_failed.
        const isPermanentValidation =
          err.validation === true && err.permanent === true;
        // Missing media is also permanent — retrying won't help until media is fixed
        const isMissingMedia =
          err.validation === true && err.permanent === false;
        // Meta policy blocks are permanent — user hasn't opted in or is rate-limited
        const errLower = (err.message || "").toLowerCase();
        const isMetaPolicyBlock =
          errLower.includes("healthy ecosystem") ||
          errLower.includes("not delivered") ||
          errLower.includes("spam") ||
          errLower.includes("blocked") ||
          errLower.includes("recipient not on whatsapp") ||
          errLower.includes("incapable of receiving") ||
          errLower.includes("re-engage");
        const isActuallyPermanent =
          isPermanentValidation || isMissingMedia || isMetaPolicyBlock;

        const currentRetryCount = Number(recipient.retry_count || 0);
        const nextRetryCount = currentRetryCount + 1;
        const isPermanent = isActuallyPermanent || nextRetryCount >= 3;
        const backoffMinutes =
          nextRetryCount === 1 ? 5 : nextRetryCount === 2 ? 15 : 45;
        const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

        if (isPermanentValidation) {
          logger.warn(
            `[CAMPAIGN-BATCH] VALIDATION FAILURE (permanent) — will not retry:\n${JSON.stringify(diagContext, null, 2)}`,
          );
        } else if (isMissingMedia) {
          // Missing media affects the whole campaign, not just this recipient — log prominently
          logger.error(
            `[CAMPAIGN-BATCH] MEDIA MISSING — campaign ${campaign_id} has no usable media. All recipients will fail until media is fixed:\n${JSON.stringify(diagContext, null, 2)}`,
          );
        } else if (isMetaPolicyBlock) {
          logger.warn(
            `[CAMPAIGN-BATCH] META POLICY BLOCK (permanent) — recipient hasn't opted in or is rate-limited:\n${JSON.stringify(diagContext, null, 2)}`,
          );
        } else {
          logger.warn(
            `[CAMPAIGN-BATCH] Send failed (attempt=${nextRetryCount}/3, permanent=${isPermanent}):\n${JSON.stringify(diagContext, null, 2)}`,
          );
        }

        await recipient.update({
          status: isPermanent ? "permanently_failed" : "failed",
          error_message: err.message,
          last_error: err.message,
          retry_count: isActuallyPermanent ? 3 : nextRetryCount,
          next_retry_at: isPermanent ? null : nextRetryAt,
        });
      }

      // Delay between individual sends to prevent Meta API rate limiting
      await sleep(500);
      // Yield to event loop so chatbot webhooks are not starved
      await new Promise((resolve) => setImmediate(resolve));
    }

    logger.info(
      `[CAMPAIGN-BATCH] Batch finished for campaign ${campaign_id} — sent=${batchSentCount} failed=${batchFailCount} total=${recipients.length}`,
    );
    return {
      finished: false,
      processedCount: recipients.length,
      sentCount: batchSentCount,
      failCount: batchFailCount,
    };
  } catch (err) {
    throw err;
  } finally {
    runningCampaigns.delete(campaign_id);
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
  logger.info("[CAMPAIGN-SCHEDULER] Started");

  // Run every minute
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();

      // 1. Check for scheduled campaigns that need to be activated
      const [scheduledToActiveCount] = await db.WhatsappCampaigns.update(
        { status: "active" },
        {
          where: {
            status: "scheduled",
            scheduled_at: { [db.Sequelize.Op.lte]: now },
            is_deleted: false,
          },
        },
      );

      if (scheduledToActiveCount > 0) {
        logger.info(
          `[CAMPAIGN-SCHEDULER] Activated ${scheduledToActiveCount} scheduled campaign(s) at ${now.toISOString()}`,
        );
      }

      const activeCampaigns = await db.WhatsappCampaigns.findAll({
        where: { status: "active", is_deleted: false },
      });

      for (const campaign of activeCampaigns) {
        try {
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
            const pendingCount = await db.WhatsappCampaignRecipients.count({
              where: { campaign_id: campaign.campaign_id, status: "pending" },
            });
            const batchEstimate = Math.min(pendingCount, 15);
            const batchCost = cost.totalCostInr * batchEstimate;

            const billingCheck = await canSendCampaign(
              campaign.tenant_id,
              batchCost,
            );

            if (!billingCheck.allowed) {
              logger.warn(
                `[CAMPAIGN-SCHEDULER] Skipping campaign ${campaign.campaign_id} - ${billingCheck.reason}`,
              );
              await campaign.update({ status: "paused" });
              continue;
            }
          } catch (billingErr) {
            logger.error(
              `[CAMPAIGN-SCHEDULER] Billing check error for ${campaign.campaign_id}: ${billingErr.message}`,
            );
            // Fail open — proceed with execution
          }

          logger.info(
            `[CAMPAIGN-SCHEDULER] Executing batch for campaign ${campaign.campaign_id}`,
          );
          const batchResult = await executeCampaignBatchService(
            campaign.campaign_id,
            campaign.tenant_id,
            15,
          );
          logger.info(
            `[CAMPAIGN-SCHEDULER] Campaign ${campaign.campaign_id} batch done — processed=${batchResult.processedCount ?? 0} sent=${batchResult.sentCount ?? 0} failed=${batchResult.failCount ?? 0} finished=${batchResult.finished}`,
          );
          // Delay between campaigns to protect chatbot event loop
          await sleep(3000);
        } catch (campaignErr) {
          logger.error(
            `[CAMPAIGN-SCHEDULER] Campaign ${campaign.campaign_id} execution error: ${campaignErr.message}`,
          );
        }
      }
    } catch (err) {
      logger.error(`[CAMPAIGN-SCHEDULER] Worker error: ${err.message}`);
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
        limit: 30,
      });

      const campaignIds = [
        ...new Set(failedRecipients.map((recipient) => recipient.campaign_id)),
      ];
      const campaigns = await db.WhatsappCampaigns.findAll({
        where: {
          campaign_id: { [db.Sequelize.Op.in]: campaignIds },
          is_deleted: false,
        },
        attributes: ["campaign_id", "tenant_id", "status"],
      });
      const campaignById = new Map(
        campaigns.map((campaign) => [campaign.campaign_id, campaign]),
      );

      const campaignIdsToResume = new Set();
      for (const recipient of failedRecipients) {
        const campaign = campaignById.get(recipient.campaign_id);
        if (!campaign) continue;

        // Skip cancelled or completed campaigns — retrying them is pointless
        if (["cancelled", "completed"].includes(campaign.status)) {
          logger.info(
            `[CAMPAIGN-RETRY] Campaign ${recipient.campaign_id} is ${campaign.status} — skipping recipient ${recipient.id}`,
          );
          continue;
        }

        if (campaign.status === "paused") {
          logger.info(
            `[CAMPAIGN-RETRY] Campaign ${recipient.campaign_id} is paused — keeping recipient ${recipient.id} in failed state until resume`,
          );
          continue;
        }

        // Skip recipients whose error indicates a non-retryable issue (media missing, validation, Meta policy)
        const errorMsg = String(recipient.error_message || "").toLowerCase();
        const isNonRetryableError =
          errorMsg.includes("missing media") ||
          errorMsg.includes("no valid url") ||
          errorMsg.includes("variable mismatch") ||
          errorMsg.includes("invalid phone") ||
          errorMsg.includes("healthy ecosystem") ||
          errorMsg.includes("not delivered") ||
          errorMsg.includes("spam") ||
          errorMsg.includes("blocked") ||
          errorMsg.includes("recipient not on whatsapp") ||
          errorMsg.includes("incapable of receiving") ||
          errorMsg.includes("re-engage");
        if (isNonRetryableError) {
          logger.info(
            `[CAMPAIGN-RETRY] Recipient ${recipient.id} has non-retryable error — marking permanently_failed`,
          );
          await recipient.update({
            status: "permanently_failed",
            retry_count: 3,
            next_retry_at: null,
          });
          continue;
        }

        await recipient.update({
          status: "pending",
        });
        campaignIdsToResume.add(recipient.campaign_id);
      }

      for (const campaignId of campaignIdsToResume) {
        const campaign = campaignById.get(campaignId);
        if (!campaign) continue;
        // Only auto-resume campaigns that failed — 'scheduled' campaigns must
        // not be activated early (they have a scheduled_at time to honour).
        if (["failed", "completed"].includes(campaign.status)) {
          await campaign.update({ status: "active" });
        }
        logger.info(
          `[CAMPAIGN-RETRY] Executing batch for campaign ${campaignId}`,
        );
        await executeCampaignBatchService(campaignId, campaign.tenant_id, 15);
        await sleep(3000);
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

export const updateCampaignStatusService = async (
  campaign_id,
  tenant_id,
  nextStatusRaw,
  acted_by = "unknown",
) => {
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

  // Idempotent: already in the desired state — treat as success, no DB write needed.
  if (current === next) {
    return campaign;
  }

  // If user tries to pause an already-completed or cancelled campaign, the intent
  // (stop sending) is already satisfied — return success instead of a confusing error.
  if (next === "paused" && ["completed", "cancelled"].includes(current)) {
    return campaign;
  }

  const key = `${current}->${next}`;
  if (!allowed.has(key)) {
    throw new Error(
      `Invalid status transition: ${toTransitionLabel(current)} -> ${toTransitionLabel(next)}`,
    );
  }

  await campaign.update({ status: next });

  if (next === "paused") {
    const pendingCount = await db.WhatsappCampaignRecipients.count({
      where: { campaign_id, status: "pending" },
    });
    logger.info(
      `[CAMPAIGN-STATUS] Campaign ${campaign_id} paused by ${acted_by} at ${new Date().toISOString()} — ${pendingCount} recipients still pending`,
    );
  } else if (next === "active" && current === "paused") {
    const pendingCount = await db.WhatsappCampaignRecipients.count({
      where: { campaign_id, status: "pending" },
    });
    logger.info(
      `[CAMPAIGN-STATUS] Campaign ${campaign_id} resumed by ${acted_by} at ${new Date().toISOString()} — ${pendingCount} recipients remaining`,
    );

    // Trigger immediate batch execution so user doesn't wait for scheduler
    if (pendingCount > 0) {
      setImmediate(async () => {
        try {
          await executeCampaignBatchService(campaign_id, tenant_id, 15);
        } catch (err) {
          logger.error(
            `[CAMPAIGN-STATUS] Immediate batch after resume failed for ${campaign_id}: ${err.message}`,
          );
        }
      });
    }
  }

  return campaign;
};

export const recordCampaignEventService = async (payload = {}) => {
  const campaign_id = payload.campaign_id || payload.campaignId;
  const recipient_id = payload.recipient_id || payload.recipientId;
  const event_type = String(
    payload.event_type || payload.eventType || "",
  ).toLowerCase();
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

  const [
    pendingCount,
    sentOnlyCount,
    deliveredOnlyCount,
    readOnlyCount,
    failedCount,
    totalCount,
  ] = await Promise.all([
    db.WhatsappCampaignRecipients.count({
      where: {
        campaign_id,
        is_deleted: false,
        status: "pending",
      },
    }),
    db.WhatsappCampaignRecipients.count({
      where: {
        campaign_id,
        is_deleted: false,
        status: "sent",
      },
    }),
    db.WhatsappCampaignRecipients.count({
      where: {
        campaign_id,
        is_deleted: false,
        status: "delivered",
      },
    }),
    db.WhatsappCampaignRecipients.count({
      where: {
        campaign_id,
        is_deleted: false,
        status: "read",
      },
    }),
    db.WhatsappCampaignRecipients.count({
      where: buildRecipientStatusWhere(campaign_id, "failed"),
    }),
    db.WhatsappCampaignRecipients.count({
      where: {
        campaign_id,
        is_deleted: false,
      },
    }),
  ]);

  const total_sent = await db.WhatsappCampaignRecipients.count({
    where: {
      campaign_id,
      is_deleted: false,
      status: {
        [db.Sequelize.Op.in]: ["sent", "delivered", "read", "replied"],
      },
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
  const click_rate = Number(
    ((total_clicked / safeDenominator) * 100).toFixed(2),
  );

  // Fetch the latest failed recipient error message for UI display
  let latest_failed_error = null;
  if (failedCount > 0) {
    const latestFailed = await db.WhatsappCampaignRecipients.findOne({
      where: buildRecipientStatusWhere(campaign_id, "failed"),
      attributes: ["error_message"],
      order: [["updatedAt", "DESC"]],
    });
    latest_failed_error = latestFailed?.error_message?.trim() || null;
  }

  return {
    total_sent,
    total_delivered,
    total_opened,
    total_clicked,
    open_rate,
    click_rate,
    latest_failed_error,
    status_counts: {
      all: totalCount,
      pending: pendingCount,
      sent: sentOnlyCount,
      delivered: deliveredOnlyCount,
      read: readOnlyCount,
      failed: failedCount,
    },
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

export const resolveRecipientCount = async (
  tenant_id,
  audience_type,
  audience_data,
) => {
  const { default: db } = await import("../../database/index.js");

  switch (audience_type) {
    case "manual":
      return Array.isArray(audience_data) ? audience_data.length : 0;
    case "csv":
      return Array.isArray(audience_data) ? audience_data.length : 0;
    case "all_contacts":
      return await db.Contacts.count({
        where: { tenant_id, is_deleted: false },
      });
    case "all_leads":
      return await db.Leads.count({ where: { tenant_id, is_deleted: false } });
    case "group":
      if (Array.isArray(audience_data)) return audience_data.length; // Personalized group data provided as array
      return await db.ContactGroupMembers.count({
        where: { tenant_id, group_id: audience_data },
      });
    default:
      return 0;
  }
};
