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
import { estimateMetaCost } from "../../utils/billing/costEstimator.js";
import { checkBillingAccess } from "../../services/billingAccess.service.js";
import {
  isCampaignQueueAvailable,
  getCampaignDispatchQueue,
  getTenantQueue,
} from "../../queues/campaignQueue.js";
import { enqueueSendJobs } from "../../workers/dispatchCampaign.js";
import { removeSendJobIfPresent } from "../../workers/sendJobHelpers.js";
import { addCampaignUsageService } from "../GalleryModel/gallery.service.js";
import { logger } from "../../utils/logger.js";
import { recordCampaignDiagnosticEvent } from "../../utils/campaignDiagnosticsEvents.js";
import { getIO } from "../../middlewares/socket/socket.js";
import {
  getDeletedCampaigns,
  hardDeleteCampaign,
  restoreCampaign,
  softDeleteCampaign,
} from "./whatsappcampaign.lifecycle.js";

// How long a campaign can sit "active" with pending recipients and no recipient
// progress before the scheduler treats it as stuck and re-dispatches it.
const CAMPAIGN_STALE_RECOVERY_MS = parseInt(
  process.env.CAMPAIGN_STALE_RECOVERY_MS || "600000",
  10,
);

const CAMPAIGN_RECOVERY_MAX_FAILED_SEND_JOBS = parseInt(
  process.env.CAMPAIGN_RECOVERY_MAX_FAILED_SEND_JOBS || "1",
  10,
);

// B-7: Max queue depth before backoff on stuck-campaign recovery to prevent unbounded queue growth
const MAX_QUEUE_WAITING_BEFORE_BACKOFF = parseInt(
  process.env.MAX_QUEUE_WAITING_BEFORE_BACKOFF || "500",
  10,
);

// B-11: Max hours a campaign can stay "active" before auto-cancelling due to stalled progress
const CAMPAIGN_MAX_ACTIVE_HOURS = parseInt(
  process.env.CAMPAIGN_MAX_ACTIVE_HOURS || "48",
  10,
);

/**
 * Enqueues the initial dispatch job for a campaign onto the BullMQ
 * `campaign-dispatch` queue. The jobId is idempotent (`dispatch:{id}:0`) so
 * re-enqueuing an already-queued/running dispatch is a safe no-op.
 *
 * B-3: Also updates campaign.last_dispatch_enqueued_at timestamp to prevent
 * premature finalization (webhook cannot mark campaign complete until this
 * timestamp is >5 minutes old).
 *
 * Returns true when the job was enqueued, false when the queue is unavailable
 * (Redis down). In the unavailable case the scheduler recovery loop will keep
 * retrying once the queue comes back.
 */
const enqueueCampaignDispatch = async (campaign_id, tenant_id) => {
  if (!isCampaignQueueAvailable()) {
    logger.warn(
      `[CAMPAIGN-DISPATCH] Queue unavailable — cannot dispatch campaign ${campaign_id} yet. Scheduler recovery will retry.`,
    );
    return false;
  }

  const dispatchQueue = getCampaignDispatchQueue();
  const jobId = `dispatch:${campaign_id}:0`;

  // BullMQ deduplicates by jobId: if a finished (completed/failed) job with this
  // id still lingers in Redis, a plain add() is SILENTLY ignored and the
  // campaign never dispatches. Remove any finished job first so re-dispatch
  // (initial create OR scheduler recovery) always runs. If the job is currently
  // active, remove() throws — we skip, because a live dispatch already covers
  // this campaign.
  try {
    await dispatchQueue.remove(jobId);
  } catch (err) {
    logger.debug(
      `[CAMPAIGN-DISPATCH] Could not remove existing job ${jobId} (likely active): ${err.message}`,
    );
  }

  await dispatchQueue.add(
    "campaign-dispatch",
    { campaign_id, tenant_id, after_id: 0 },
    { jobId, removeOnComplete: true, removeOnFail: true },
  );

  // B-3: Update timestamp to guard against premature finalization in webhook
  // This timestamp tells finalization logic "a dispatch is in flight, don't
  // mark complete yet even if no pending recipients found"
  try {
    await db.WhatsappCampaigns.update(
      { last_dispatch_enqueued_at: new Date() },
      { where: { campaign_id } },
    );
  } catch (err) {
    logger.warn(
      `[CAMPAIGN-DISPATCH] Could not update last_dispatch_enqueued_at for ${campaign_id}: ${err.message}`,
    );
    // Non-fatal; continue — just means B-3 guard won't work for this dispatch
  }

  return true;
};

const createHttpError = (statusCode, message, extra = {}) =>
  Object.assign(new Error(message), { statusCode, ...extra });

const normalizeRecipientIds = (recipientIds = []) =>
  Array.from(
    new Set(
      (Array.isArray(recipientIds) ? recipientIds : [recipientIds])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );

const clearExistingSendJobsForRecipients = async ({
  tenant_id,
  campaign_id,
  recipientIds,
  logContext,
}) => {
  if (!isCampaignQueueAvailable()) {
    throw createHttpError(
      503,
      "Campaign queue unavailable. Check REDIS_URL and Redis service.",
    );
  }

  const normalizedRecipientIds = normalizeRecipientIds(recipientIds);
  if (normalizedRecipientIds.length === 0) {
    return [];
  }

  const sendQueue = getTenantQueue(tenant_id);
  const results = [];

  for (const recipientId of normalizedRecipientIds) {
    results.push(
      await removeSendJobIfPresent(sendQueue, campaign_id, recipientId, {
        logContext,
      }),
    );
  }

  return results;
};

const loadRetryRecipientsForTenant = async (tenant_id, filters = {}) => {
  const {
    campaign_id = null,
    recipient_ids = [],
    recipient_status = null,
  } = filters;

  const normalizedRecipientIds = normalizeRecipientIds(recipient_ids);
  const normalizedStatus = recipient_status
    ? String(recipient_status).trim().toLowerCase()
    : null;

  if (normalizedRecipientIds.length > 0 && campaign_id) {
    throw createHttpError(
      400,
      "Provide either recipient_ids or campaign_id, not both.",
    );
  }

  if (normalizedRecipientIds.length === 0 && !campaign_id) {
    throw createHttpError(
      400,
      "recipient_ids or campaign_id is required for campaign recipient retry.",
    );
  }

  if (campaign_id) {
    const campaign = await db.WhatsappCampaigns.findOne({
      where: {
        campaign_id,
        tenant_id,
        is_deleted: false,
      },
      attributes: ["campaign_id", "tenant_id", "status", "paused_reason"],
      raw: true,
    });

    if (!campaign) {
      throw createHttpError(404, "Campaign not found");
    }

    const where = {
      campaign_id,
      is_deleted: false,
    };
    if (normalizedStatus) {
      where.status = normalizedStatus;
    }

    const recipients = await db.WhatsappCampaignRecipients.findAll({
      where,
      attributes: [
        "id",
        "campaign_id",
        "status",
        "error_message",
        "retry_count",
      ],
      order: [["id", "ASC"]],
      raw: true,
    });

    if (recipients.length === 0) {
      throw createHttpError(
        404,
        normalizedStatus
          ? `No recipients found for campaign ${campaign_id} with status ${normalizedStatus}`
          : `No recipients found for campaign ${campaign_id}`,
      );
    }

    return {
      campaignScope: campaign,
      recipients,
      requested_status: normalizedStatus,
    };
  }

  const recipients = await db.WhatsappCampaignRecipients.findAll({
    where: {
      id: { [db.Sequelize.Op.in]: normalizedRecipientIds },
      is_deleted: false,
    },
    include: [
      {
        model: db.WhatsappCampaigns,
        as: "campaign",
        required: true,
        where: {
          tenant_id,
          is_deleted: false,
        },
        attributes: ["campaign_id", "tenant_id", "status", "paused_reason"],
      },
    ],
    attributes: [
      "id",
      "campaign_id",
      "status",
      "error_message",
      "retry_count",
    ],
    order: [["id", "ASC"]],
  });

  if (recipients.length === 0) {
    throw createHttpError(404, "No matching recipients found");
  }

  const foundRecipientIds = new Set(recipients.map((recipient) => recipient.id));
  const missingRecipientIds = normalizedRecipientIds.filter(
    (recipientId) => !foundRecipientIds.has(recipientId),
  );
  if (missingRecipientIds.length > 0) {
    throw createHttpError(
      404,
      `Recipients not found for this tenant: ${missingRecipientIds.join(", ")}`,
      { missingRecipientIds },
    );
  }

  return {
    campaignScope: null,
    recipients: recipients.map((recipient) => ({
      id: recipient.id,
      campaign_id: recipient.campaign_id,
      status: recipient.status,
      error_message: recipient.error_message,
      retry_count: recipient.retry_count,
      campaign: recipient.campaign,
    })),
    requested_status: normalizedStatus,
  };
};

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

    // F-5 FIX: Validate minimum schedule time (must be at least 2 minutes from now)
    // Matches frontend's hard-coded 2-minute minimum in getMinScheduleDateTime()
    if (scheduledAtUtc) {
      const SCHEDULE_MIN_FUTURE_MS = 2 * 60 * 1000; // 2 minutes
      const now = new Date();
      const timeUntilScheduled = scheduledAtUtc.getTime() - now.getTime();
      if (timeUntilScheduled < SCHEDULE_MIN_FUTURE_MS) {
        throw new Error(
          `Campaign must be scheduled at least 2 minutes from now. Requested time is only ${Math.round(timeUntilScheduled / 1000)} seconds away.`,
        );
      }
    }

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

    // 6. Immediate (non-scheduled) campaigns must be dispatched now. Scheduled
    //    campaigns are picked up by the cron once their scheduled_at is due.
    //    A queue failure here must NOT fail campaign creation — the scheduler's
    //    recovery loop re-dispatches any stuck active campaign automatically.
    if (normalizedCampaignType !== "scheduled") {
      try {
        const enqueued = await enqueueCampaignDispatch(campaign_id, tenant_id);
        if (enqueued) {
          logger.info(
            `[CAMPAIGN-CREATE] Dispatch enqueued for immediate campaign ${campaign_id}`,
          );
        }
      } catch (err) {
        logger.error(
          `[CAMPAIGN-CREATE] Failed to enqueue dispatch for ${campaign_id}: ${err.message} — scheduler recovery will retry.`,
        );
      }
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
export const executeCampaignBatchService = async (campaign_id, tenant_id) => {
  const campaign = await db.WhatsappCampaigns.findOne({
    where: { campaign_id, tenant_id, is_deleted: false },
    attributes: ["campaign_id", "tenant_id", "status"],
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (["completed", "cancelled"].includes(campaign.status)) {
    throw new Error(`Campaign is ${campaign.status} and cannot be executed`);
  }

  // A paused campaign must be resumed explicitly. Do not let execute()
  // silently reactivate it, or the UI/user intent to pause is lost.
  if (campaign.status === "paused") {
    throw new Error("Campaign is paused and must be resumed before execution");
  }

  // Ensure the campaign is active so the dispatch/send workers will process it.
  if (campaign.status !== "active") {
    await db.WhatsappCampaigns.update(
      { status: "active" },
      { where: { campaign_id, tenant_id, is_deleted: false } },
    );
  }

  // Fire the dispatch immediately instead of waiting for the recovery cron.
  const dispatched = await enqueueCampaignDispatch(campaign_id, tenant_id);

  return { campaign_id, status: "active", dispatched };
};

export const resolveRecipientCount = async (
  tenant_id,
  audience_type,
  audience_data,
) => {
  if (Array.isArray(audience_data)) {
    return audience_data.length;
  }

  if (audience_type === "group" && audience_data) {
    const groupId =
      typeof audience_data === "object"
        ? audience_data.group_id || audience_data.id
        : audience_data;

    if (!groupId) {
      return 0;
    }

    return db.ContactGroupMembers.count({
      where: { tenant_id, group_id: groupId },
    });
  }

  return 0;
};

export const softDeleteCampaignService = async (tenant_id, campaign_id) => {
  await softDeleteCampaign(campaign_id, tenant_id);
  return { success: true };
};

export const permanentDeleteCampaignService = async (
  tenant_id,
  campaign_id,
) => {
  await hardDeleteCampaign(campaign_id, tenant_id);
  return { success: true };
};

export const getDeletedCampaignListService = async (
  tenant_id,
  page = 1,
  limit = 20,
) => {
  return getDeletedCampaigns(tenant_id, Number(page) || 1, Number(limit) || 20);
};

export const restoreCampaignService = async (campaign_id, tenant_id) => {
  const data = await restoreCampaign(campaign_id, tenant_id);
  return { message: "Campaign restored", data };
};

export const updateCampaignStatusService = async (
  tenant_id,
  campaign_id,
  status,
) => {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();
  if (normalizedStatus === "active") {
    const campaign = await db.WhatsappCampaigns.findOne({
      where: { tenant_id, campaign_id, is_deleted: false },
      include: [{ model: db.WhatsappTemplates, as: "template", attributes: ["category"] }],
      attributes: ["campaign_id"],
    });
    if (!campaign) throw new Error("Campaign not found");

    const pendingCount = await db.WhatsappCampaignRecipients.count({
      where: { campaign_id, status: "pending", is_deleted: false },
    });
    const batchSize = Math.min(pendingCount, Number(process.env.CAMPAIGN_DISPATCH_PAGE_SIZE) || 500);
    let estimatedCost = 0;
    if (batchSize > 0) {
      const tenant = await db.Tenants.findOne({
        where: { tenant_id },
        attributes: ["country", "owner_country_code", "timezone"],
        raw: true,
      });
      const isIndia = tenant?.owner_country_code === "91" || tenant?.timezone === "Asia/Kolkata";
      const cost = await estimateMetaCost(
        (campaign.template?.category || "marketing").toLowerCase(),
        tenant?.country || (isIndia ? "IN" : "Global"),
      );
      estimatedCost = (Number(cost.totalCostInr) || 0) * batchSize;
    }
    const access = await checkBillingAccess(tenant_id, estimatedCost);
    if (!access.allowed) {
      const error = new Error(access.blocked_reason || "Billing access denied");
      error.statusCode = 403;
      error.billingAccess = access;
      throw error;
    }
  }
  const updateFields = { status };
  if (normalizedStatus === "active") {
    updateFields.paused_reason = null;
  }

  const [affectedRows] = await db.WhatsappCampaigns.update(updateFields, {
    where: { tenant_id, campaign_id, is_deleted: false },
  });

  // Resuming/starting a campaign must immediately re-dispatch its pending
  // recipients instead of waiting for the recovery cron (~2 min). The dispatch
  // jobId is idempotent and the worker only enqueues sends for still-pending
  // recipients, so this is safe against double-sends.
  if (affectedRows > 0 && normalizedStatus === "active") {
    try {
      const pendingRecipients = await db.WhatsappCampaignRecipients.findAll({
        where: {
          campaign_id,
          status: "pending",
          is_deleted: false,
        },
        attributes: ["id"],
        raw: true,
      });

      await clearExistingSendJobsForRecipients({
        tenant_id,
        campaign_id,
        recipientIds: pendingRecipients.map((recipient) => recipient.id),
        logContext: "CAMPAIGN-RESUME",
      });

      await enqueueCampaignDispatch(campaign_id, tenant_id);
    } catch (err) {
      logger.error(
        `[CAMPAIGN-STATUS] Failed to enqueue dispatch for ${campaign_id} on resume: ${err.message} — scheduler recovery will retry.`,
      );
    }
  }

  if (affectedRows > 0 && normalizedStatus === "paused") {
    try {
      const payload = {
        campaign_id,
        status: "paused",
        paused_reason: null,
      };
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("campaign_paused", payload);
      io.to(`tenant-${tenant_id}`).emit("campaign-status-update", payload);
    } catch (err) {
      logger.warn(
        `[CAMPAIGN-STATUS] Failed to emit pause event for ${campaign_id}: ${err.message}`,
      );
    }
  }

  return { affectedRows };
};

export const retryCampaignRecipientsService = async (
  tenant_id,
  payload = {},
) => {
  const recipient_ids = payload.recipient_ids || payload.recipientIds || [];
  const campaign_id = payload.campaign_id || payload.campaignId || null;
  const recipient_status =
    payload.recipient_status ||
    payload.status_filter ||
    payload.statusFilter ||
    (campaign_id ? payload.status || "permanently_failed" : payload.status) ||
    null;

  const { recipients, requested_status } = await loadRetryRecipientsForTenant(
    tenant_id,
    {
      campaign_id,
      recipient_ids,
      recipient_status,
    },
  );

  if (!isCampaignQueueAvailable()) {
    throw createHttpError(
      503,
      "Campaign queue unavailable. Check REDIS_URL and Redis service.",
    );
  }

  const recipientsByCampaign = recipients.reduce((map, recipient) => {
    const key = recipient.campaign_id;
    if (!map.has(key)) {
      const campaignMeta = recipient.campaign || {
        campaign_id: recipient.campaign_id,
        tenant_id,
      };
      map.set(key, {
        campaign: campaignMeta,
        recipients: [],
      });
    }
    map.get(key).recipients.push(recipient);
    return map;
  }, new Map());

  const queueCleanup = [];
  const enqueueResults = [];
  const transaction = await db.sequelize.transaction();

  try {
    await db.WhatsappCampaignRecipients.update(
      {
        status: "pending",
        error_message: null,
        last_error: null,
        retry_count: 0,
        next_retry_at: null,
      },
      {
        where: {
          id: {
            [db.Sequelize.Op.in]: recipients.map((recipient) => recipient.id),
          },
        },
        transaction,
      },
    );

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  for (const [campaignKey, group] of recipientsByCampaign.entries()) {
    const campaignMeta = group.campaign || {};
    const recipientIdsForCampaign = group.recipients.map(
      (recipient) => recipient.id,
    );

    const removedJobs = await clearExistingSendJobsForRecipients({
      tenant_id: campaignMeta.tenant_id || tenant_id,
      campaign_id: campaignKey,
      recipientIds: recipientIdsForCampaign,
      logContext: "CAMPAIGN-RECIPIENT-RETRY",
    });
    queueCleanup.push(...removedJobs);

    const sendQueue = getTenantQueue(campaignMeta.tenant_id || tenant_id);
    const enqueueResult = await enqueueSendJobs(
      sendQueue,
      campaignKey,
      campaignMeta.tenant_id || tenant_id,
      group.recipients.map((recipient) => ({ id: recipient.id })),
    );

    enqueueResults.push({
      campaign_id: campaignKey,
      recipient_ids: recipientIdsForCampaign,
      enqueue: enqueueResult,
    });
  }

  return {
    retried_count: recipients.length,
    campaign_count: recipientsByCampaign.size,
    requested_status: requested_status || null,
    recipient_ids: recipients.map((recipient) => recipient.id),
    campaign_ids: Array.from(recipientsByCampaign.keys()),
    queue_cleanup: queueCleanup,
    enqueue_results: enqueueResults,
  };
};

export const recordCampaignEventService = async ({
  campaign_id,
  recipient_id = null,
  event_type = "event",
}) => {
  if (!db.CampaignEvents || !recipient_id) {
    return null;
  }

  return db.CampaignEvents.create({
    campaign_id,
    recipient_id,
    event_type: ["open", "click"].includes(event_type) ? event_type : "open",
  });
};

export const getCampaignStatsService = async (tenant_id, campaign_id) => {
  const campaign = await db.WhatsappCampaigns.findOne({
    where: { tenant_id, campaign_id, is_deleted: false },
    raw: true,
  });

  if (!campaign) {
    throw new Error("Campaign not found");
  }

  const recipients = await db.WhatsappCampaignRecipients.findAll({
    where: { campaign_id, is_deleted: false },
    attributes: [
      "status",
      "error_message",
      [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
    ],
    group: ["status"],
    raw: true,
  });

  const byStatus = recipients.reduce((acc, row) => {
    acc[row.status] = Number(row.count) || 0;
    return acc;
  }, {});

  // Calculate actual counts from recipient statuses.
  // Each recipient occupies exactly one terminal state, so the sent card
  // should only reflect recipients whose current status is `sent`.
  const totalSent = byStatus.sent || 0;
  const totalDelivered = byStatus.delivered || 0;
  const totalOpened = byStatus.read || 0;
  const totalClicked = byStatus.replied || 0;

  const totalAudience = campaign.total_audience || 1;
  const openRate =
    totalAudience > 0 ? Math.round((totalOpened / totalAudience) * 100) : 0;
  const clickRate =
    totalAudience > 0 ? Math.round((totalClicked / totalAudience) * 100) : 0;

  // Get latest failed error from any permanently_failed recipient
  let latestFailedError = null;
  if (byStatus.permanently_failed > 0 || byStatus.failed > 0) {
    const failedRecipient = await db.WhatsappCampaignRecipients.findOne({
      where: {
        campaign_id,
        is_deleted: false,
        status: { [db.Sequelize.Op.in]: ["failed", "permanently_failed"] },
      },
      attributes: ["error_message", "last_error"],
      order: [["updated_at", "DESC"]],
      raw: true,
    });
    if (failedRecipient) {
      latestFailedError =
        failedRecipient.error_message || failedRecipient.last_error;
    }
  }

  return {
    total_sent: totalSent,
    total_delivered: totalDelivered,
    total_opened: totalOpened,
    total_clicked: totalClicked,
    open_rate: openRate,
    click_rate: clickRate,
    latest_failed_error: latestFailedError,
    status_counts: {
      all: totalAudience,
      pending: byStatus.pending || 0,
      sent: byStatus.sent || 0,
      delivered: byStatus.delivered || 0,
      read: byStatus.read || 0,
      failed: (byStatus.failed || 0) + (byStatus.permanently_failed || 0),
    },
  };
};

export const startCampaignSchedulerService = () => {
  cron.schedule("* * * * *", async () => {
    try {
      if (!isCampaignQueueAvailable()) {
        return;
      }

      // 1. Dispatch scheduled campaigns whose scheduled_at is now due.
      const dueCampaigns = await db.WhatsappCampaigns.findAll({
        where: {
          status: "scheduled",
          is_deleted: false,
          scheduled_at: { [db.Sequelize.Op.lte]: new Date() },
        },
        attributes: ["campaign_id", "tenant_id"],
        limit: 50,
        raw: true,
      });

      for (const campaign of dueCampaigns) {
        await enqueueCampaignDispatch(campaign.campaign_id, campaign.tenant_id);
      }

      // 2. Self-heal: re-dispatch active campaigns that stalled with pending
      //    recipients (missed initial dispatch, backend restart, Redis blip,
      //    or a crash mid-run). Idempotent dispatch jobId makes this safe.
      await recoverStuckActiveCampaigns();

      // B-11: Auto-cancel campaigns that have been active for too long with
      //    insufficient progress (e.g., flaky template, unforeseen scale issue)
      await autoCancelStagnantActiveCampaigns();

      // 3. Self-heal: finalize active campaigns that have NO pending recipients
      //    left (every recipient is sent or permanently_failed) but were never
      //    flipped to "completed" — e.g. last recipients failed via the
      //    retry-exhaustion path. Without this they show "active" forever.
      await finalizeFinishedActiveCampaigns();
    } catch (err) {
      logger.error(`[CAMPAIGN-SCHEDULER] Failed: ${err.message}`);
    }
  });
};

/**
 * Marks as "completed" any active (non-deleted) campaign that has at least one
 * recipient but none still in "pending". Campaign recipients only ever finish
 * as "sent" or "permanently_failed", so a fully-failed campaign must still
 * complete instead of sitting "active" indefinitely.
 *
 * B-3: Only finalizes campaigns whose last_dispatch_enqueued_at is >5 minutes old.
 * This prevents marking a campaign complete while a fresh dispatch is still in
 * flight (race condition where webhook counts pending before dispatch re-enqueues).
 * Idempotent — the UPDATE only touches rows currently in "active".
 */
export const finalizeFinishedActiveCampaigns = async () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await db.sequelize.query(
    `UPDATE ${tableNames.WHATSAPP_CAMPAIGN} c
        SET c.status = 'completed'
      WHERE c.status = 'active'
        AND c.is_deleted = false
        AND (c.last_dispatch_enqueued_at IS NULL OR c.last_dispatch_enqueued_at < ?)
        AND EXISTS (
          SELECT 1 FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r
           WHERE r.campaign_id = c.campaign_id
             AND r.is_deleted = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r2
           WHERE r2.campaign_id = c.campaign_id
             AND r2.status = 'pending'
             AND r2.is_deleted = false
        )`,
    { replacements: [fiveMinutesAgo] },
  );
};

/**
 * Finds campaigns stuck in "active" with pending recipients that have shown no
 * progress for at least CAMPAIGN_STALE_RECOVERY_MS, and re-enqueues their
 * dispatch job. This guarantees an immediate campaign always sends even if the
 * initial dispatch enqueue was lost (queue down at create time, process
 * restart before the dispatch worker ran, Redis blip, etc.).
 *
 * Safe by design:
 *  - Dispatch jobId `dispatch:{id}:0` dedupes, so a still-running dispatch is
 *    not duplicated.
 *  - The "no recent recipient progress" filter prevents touching healthy,
 *    actively-sending campaigns (their recipients update `updated_at` as they
 *    transition out of "pending").
 *  - B-7: Checks queue depth and backs off if queue is heavily backlogged to
 *    prevent unbounded queue growth under slow-dispatch conditions.
 */
export const recoverStuckActiveCampaigns = async () => {
  if (!isCampaignQueueAvailable()) {
    return;
  }

  // B-7: Check queue depth before adding more recovery jobs
  const dispatchQueue = getCampaignDispatchQueue();
  let queueDepth = 0;
  try {
    const counts = await dispatchQueue.getJobCounts(
      "waiting",
      "active",
      "delayed",
    );
    queueDepth = (counts.waiting || 0) + (counts.active || 0);
    if (queueDepth > MAX_QUEUE_WAITING_BEFORE_BACKOFF) {
      logger.warn(
        `[CAMPAIGN-RECOVERY] Queue depth (${queueDepth}) exceeds backoff threshold (${MAX_QUEUE_WAITING_BEFORE_BACKOFF}) — skipping recovery this cycle to prevent unbounded growth`,
      );
      return;
    }
  } catch (err) {
    logger.warn(
      `[CAMPAIGN-RECOVERY] Could not check queue depth: ${err.message} — continuing anyway`,
    );
  }

  const staleBefore = new Date(Date.now() - CAMPAIGN_STALE_RECOVERY_MS);

  const recentlyDispatchedStuckCampaigns = await db.sequelize.query(
    `SELECT c.campaign_id, c.tenant_id, c.last_dispatch_enqueued_at
       FROM ${tableNames.WHATSAPP_CAMPAIGN} c
      WHERE c.status = 'active'
        AND c.is_deleted = false
        AND c.last_dispatch_enqueued_at IS NOT NULL
        AND c.last_dispatch_enqueued_at >= :staleBefore
        AND EXISTS (
          SELECT 1 FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r
           WHERE r.campaign_id = c.campaign_id
             AND r.status = 'pending'
             AND r.is_deleted = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r2
           WHERE r2.campaign_id = c.campaign_id
             AND r2.is_deleted = false
             AND r2.updated_at > :staleBefore
        )
      LIMIT 50`,
    {
      replacements: { staleBefore },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );

  for (const campaign of recentlyDispatchedStuckCampaigns) {
    try {
      const tenantQueue = getTenantQueue(campaign.tenant_id);
      const failedJobs = await tenantQueue.getFailed(0, 1000);
      const campaignFailedJobs = failedJobs.filter(
        (job) => job?.data?.campaign_id === campaign.campaign_id,
      );

      if (
        campaignFailedJobs.length >= CAMPAIGN_RECOVERY_MAX_FAILED_SEND_JOBS
      ) {
        const latestFailedJob = campaignFailedJobs[0];
        const failedReason =
          latestFailedJob?.failedReason || "send job failed before completion";
        const pausedReason = `recovery_loop_detected: ${campaignFailedJobs.length} failed send job(s) already exist for pending campaign. Last error: ${failedReason}`;

        await db.WhatsappCampaigns.update(
          {
            status: "paused",
            paused_reason: pausedReason,
          },
          {
            where: {
              campaign_id: campaign.campaign_id,
              tenant_id: campaign.tenant_id,
              status: "active",
              is_deleted: false,
            },
          },
        );

        logger.error(
          `[CAMPAIGN-RECOVERY] ${campaign.campaign_id} paused to avoid recovery loop; failed_send_jobs=${campaignFailedJobs.length}; last_error=${failedReason}`,
        );
        recordCampaignDiagnosticEvent({
          source: "campaign-recovery",
          type: "error",
          level: "error",
          message: `Paused ${campaign.campaign_id} to avoid recovery loop`,
          meta: {
            campaign_id: campaign.campaign_id,
            tenant_id: campaign.tenant_id,
            failed_send_jobs: campaignFailedJobs.length,
            latest_failed_job_id: latestFailedJob?.id || null,
            latest_failed_reason: failedReason,
            campaign_status_action: "paused",
          },
        });
        continue;
      }
    } catch (err) {
      logger.warn(
        `[CAMPAIGN-RECOVERY] Could not inspect failed send jobs for ${campaign.campaign_id}: ${err.message}`,
      );
    }

    logger.warn(
      `[CAMPAIGN-RECOVERY] ${campaign.campaign_id} already re-dispatched at ${campaign.last_dispatch_enqueued_at}; skipping to avoid loop`,
    );
  }

  const stuckCampaigns = await db.sequelize.query(
    `SELECT c.campaign_id, c.tenant_id, c.last_dispatch_enqueued_at
       FROM ${tableNames.WHATSAPP_CAMPAIGN} c
      WHERE c.status = 'active'
        AND c.is_deleted = false
        AND (
          c.last_dispatch_enqueued_at IS NULL
          OR c.last_dispatch_enqueued_at < :staleBefore
        )
        AND EXISTS (
          SELECT 1 FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r
           WHERE r.campaign_id = c.campaign_id
             AND r.status = 'pending'
             AND r.is_deleted = false
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r2
           WHERE r2.campaign_id = c.campaign_id
             AND r2.is_deleted = false
             AND r2.updated_at > :staleBefore
        )
      LIMIT 50`,
    {
      replacements: { staleBefore },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );

  for (const campaign of stuckCampaigns) {
    try {
      const tenantQueue = getTenantQueue(campaign.tenant_id);
      const failedJobs = await tenantQueue.getFailed(0, 1000);
      const campaignFailedJobs = failedJobs.filter(
        (job) => job?.data?.campaign_id === campaign.campaign_id,
      );

      if (
        campaignFailedJobs.length >= CAMPAIGN_RECOVERY_MAX_FAILED_SEND_JOBS
      ) {
        const latestFailedJob = campaignFailedJobs[0];
        const failedReason =
          latestFailedJob?.failedReason || "send job failed before completion";
        const pausedReason = `recovery_loop_detected: ${campaignFailedJobs.length} failed send job(s) already exist for pending campaign. Last error: ${failedReason}`;

        await db.WhatsappCampaigns.update(
          {
            status: "paused",
            paused_reason: pausedReason,
          },
          {
            where: {
              campaign_id: campaign.campaign_id,
              tenant_id: campaign.tenant_id,
              status: "active",
              is_deleted: false,
            },
          },
        );

        logger.error(
          `[CAMPAIGN-RECOVERY] ${campaign.campaign_id} paused to avoid recovery loop; failed_send_jobs=${campaignFailedJobs.length}; last_error=${failedReason}`,
        );
        recordCampaignDiagnosticEvent({
          source: "campaign-recovery",
          type: "error",
          level: "error",
          message: `Paused ${campaign.campaign_id} to avoid recovery loop`,
          meta: {
            campaign_id: campaign.campaign_id,
            tenant_id: campaign.tenant_id,
            failed_send_jobs: campaignFailedJobs.length,
            latest_failed_job_id: latestFailedJob?.id || null,
            latest_failed_reason: failedReason,
            campaign_status_action: "paused",
          },
        });
        continue;
      }

      const enqueued = await enqueueCampaignDispatch(
        campaign.campaign_id,
        campaign.tenant_id,
      );
      if (enqueued) {
        logger.warn(
          `[CAMPAIGN-RECOVERY] Re-dispatched stuck active campaign ${campaign.campaign_id} (tenant ${campaign.tenant_id})`,
        );
      }
    } catch (err) {
      logger.error(
        `[CAMPAIGN-RECOVERY] Failed to re-dispatch ${campaign.campaign_id}: ${err.message}`,
      );
    }
  }
};

/**
 * B-11: Auto-cancel campaigns that have been active for CAMPAIGN_MAX_ACTIVE_HOURS
 * without reaching completion. This prevents campaigns from sitting "active"
 * indefinitely due to flaky templates, scale issues, or unforeseen problems.
 *
 * Campaigns are only cancelled if they show insufficient progress (less than
 * 50% of recipients processed after max time), to avoid cancelling legitimately
 * large or slow campaigns. Cancelled campaigns set status='failed' and
 * paused_reason tracks the auto-cancel reason for auditing.
 */
export const autoCancelStagnantActiveCampaigns = async () => {
  const maxAgeMs = CAMPAIGN_MAX_ACTIVE_HOURS * 60 * 60 * 1000;
  const createdBefore = new Date(Date.now() - maxAgeMs);

  try {
    // Find active campaigns older than max threshold
    const stagnantCampaigns = await db.sequelize.query(
      `SELECT 
        c.campaign_id, 
        c.tenant_id, 
        c.created_at,
        COALESCE(
          (SELECT COUNT(*) FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} 
           WHERE campaign_id = c.campaign_id AND is_deleted = false AND status IN ('sent', 'delivered', 'read', 'replied')),
          0
        ) as delivered_count,
        COALESCE(
          (SELECT COUNT(*) FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} 
           WHERE campaign_id = c.campaign_id AND is_deleted = false),
          0
        ) as total_count
       FROM ${tableNames.WHATSAPP_CAMPAIGN} c
      WHERE c.status = 'active'
        AND c.is_deleted = false
        AND c.created_at < :createdBefore`,
      {
        replacements: { createdBefore },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );

    for (const campaign of stagnantCampaigns) {
      const totalCount = Number(campaign.total_count || 0);
      const deliveredCount = Number(campaign.delivered_count || 0);
      const progressPercent =
        totalCount > 0 ? (deliveredCount / totalCount) * 100 : 0;

      // Only cancel if progress is <50% (campaign is clearly stagnating)
      if (progressPercent < 50) {
        const reason = `Auto-cancelled after ${CAMPAIGN_MAX_ACTIVE_HOURS}h: insufficient progress (${deliveredCount}/${totalCount} recipients, ${progressPercent.toFixed(1)}%)`;
        await db.WhatsappCampaigns.update(
          {
            status: "failed",
            paused_reason: reason,
          },
          {
            where: {
              campaign_id: campaign.campaign_id,
              status: "active", // Only update if still active (guard against races)
            },
          },
        );

        logger.warn(
          `[CAMPAIGN-AUTO-CANCEL] Campaign ${campaign.campaign_id} (tenant ${campaign.tenant_id}) auto-cancelled: ${reason}`,
        );

        // Emit socket event to notify users
        try {
          const io = getIO();
          io.to(`tenant-${campaign.tenant_id}`).emit("campaign-status-update", {
            campaign_id: campaign.campaign_id,
            status: "failed",
            paused_reason: reason,
          });
        } catch (socketErr) {
          logger.debug(
            `[CAMPAIGN-AUTO-CANCEL] Socket emit failed: ${socketErr.message}`,
          );
        }
      }
    }
  } catch (err) {
    logger.error(
      `[CAMPAIGN-AUTO-CANCEL] Failed to check for stagnant campaigns: ${err.message}`,
    );
  }
};
