/**
 * Campaign Send Worker
 *
 * BullMQ worker that processes one WhatsApp message per job.
 * Logic extracted from executeCampaignBatchService's inner recipient loop —
 * identical behaviour, just running inside a queue worker instead of a cron.
 *
 * Error classification:
 *   - Permanent errors (invalid phone, variable mismatch, Meta policy block,
 *     missing media) → mark recipient permanently_failed, return without throw
 *     so BullMQ treats the job as completed (no retry).
 *   - Retryable errors → throw so BullMQ retries with exponential backoff.
 *   - After all BullMQ retries exhausted → worker.on("failed") marks the
 *     recipient permanently_failed.
 */
import { Worker } from "bullmq";
import { pathToFileURL } from "url";
import { logger } from "../utils/logger.js";
import {
  initCampaignQueues,
  getRedisConnection,
  getTenantDLQ,
  getTenantQueueName,
  isCampaignQueueAvailable,
} from "../queues/campaignQueue.js";
import { getTemplateComponents } from "../utils/templateCache.js";
import { getCampaignCache } from "../utils/redis/redisCache.js";
import { getRedisLock } from "../utils/redis/redisLock.js";
import { getMetaApiCircuitBreaker } from "../services/circuitBreakerService.js";
import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";
import { sendWhatsAppTemplate } from "../models/AuthWhatsapp/AuthWhatsapp.service.js";
import {
  createContactService,
  getContactByPhoneAndTenantIdService,
} from "../models/ContactsModel/contacts.service.js";
import { createUserMessageService } from "../models/Messages/messages.service.js";
import {
  createLeadService,
  getLeadByContactIdService,
} from "../models/LeadsModel/leads.service.js";
import { formatPhoneNumber } from "../utils/helpers/formatPhoneNumber.js";
import {
  createLiveChatService,
  getLivechatByIdService,
  updateLiveChatTimestampService,
} from "../models/LiveChatModel/livechat.service.js";
import { generateWhatsAppOTPService } from "../models/OtpVerificationModel/otpverification.service.js";
import { recordCampaignDiagnosticEvent } from "../utils/campaignDiagnosticsEvents.js";
import { getIO } from "../middlewares/socket/socket.js";
import {
  batchInsertMessages,
  batchUpdateRecipientContactIds,
  batchUpdateRecipientStatuses,
} from "../services/campaign/dbBatch.js";
import {
  isNetworkSystemError,
  isMetaAuthConfigError,
  isFinallyPermanent,
  createStructuredError,
  formatErrorForLogging,
} from "../utils/metaErrorClassifier.js";

// Batch buffers per-tenant to reduce DB writes
const TENANT_BUFFERS = new Map();
const DB_BATCH_SIZE = parseInt(process.env.CAMPAIGN_DB_BATCH_SIZE || "100", 10);
const DB_BATCH_FLUSH_MS = parseInt(
  process.env.CAMPAIGN_DB_BATCH_FLUSH_MS || "500",
  10,
);

const getTenantBuffer = (tenantId) => {
  const tId = String(tenantId);
  if (!TENANT_BUFFERS.has(tId)) {
    TENANT_BUFFERS.set(tId, {
      messages: [],
      recipientUpdates: [],
      contactBackfills: [],
      recipientIdSet: new Set(), // B-1: Track recipient_ids in buffer for deduplication
      flushTimer: null,
    });
  }
  return TENANT_BUFFERS.get(tId);
};

const scheduleTenantFlush = (tenantId) => {
  const buf = TENANT_BUFFERS.get(tenantId);
  if (!buf) return;
  if (buf.flushTimer) return;
  buf.flushTimer = setTimeout(async () => {
    try {
      await flushTenantBuffers(tenantId);
    } catch (err) {
      logger.warn(
        `[SEND-WORKER] flushTenantBuffers failed for ${tenantId}: ${err.message}`,
      );
    }
  }, DB_BATCH_FLUSH_MS);
};

// Marks a campaign "completed" once it has no recipients left in "pending".
// Campaign recipients only ever end up as "sent" or "permanently_failed", so a
// campaign where every recipient failed must still transition to completed
// (it stops showing "active" forever). Only campaigns currently in a non-terminal
// status are touched, so paused/cancelled/completed are left untouched.
const EXPECTED_TERMINAL_RECIPIENT_STATUSES = [
  "sent",
  "delivered",
  "read",
  "replied",
  "permanently_failed",
];

const finalizeCampaignIfComplete = async (campaign_id) => {
  if (!campaign_id) return;
  try {
    const remainingPending = await db.WhatsappCampaignRecipients.count({
      where: { campaign_id, status: "pending", is_deleted: false },
    });
    if (remainingPending > 0) return;

    // Guard: a campaign should only ever finalize with recipients in the
    // expected terminal set. If anything else (e.g. legacy 'failed') is
    // present, log loudly so a non-terminal status can't silently leave a
    // campaign without follow-up logic in the future.
    const unexpected = await db.WhatsappCampaignRecipients.findAll({
      where: {
        campaign_id,
        is_deleted: false,
        status: {
          [db.Sequelize.Op.notIn]: EXPECTED_TERMINAL_RECIPIENT_STATUSES,
        },
      },
      attributes: ["status"],
      group: ["status"],
      raw: true,
    });
    if (unexpected.length > 0) {
      logger.error(
        `[SEND-WORKER] ALERT campaign ${campaign_id} has recipients in unexpected statuses: ${unexpected
          .map((r) => r.status)
          .join(", ")} \u2014 finalize blocked`,
      );
      return;
    }

    // B-3: Only finalize if last_dispatch_enqueued_at is >5 minutes old
    // This prevents race where webhook finalizes before all send jobs start
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const [affected] = await db.WhatsappCampaigns.update(
      { status: "completed" },
      {
        where: {
          campaign_id,
          status: {
            [db.Sequelize.Op.in]: ["active", "failed", "scheduled", "draft"],
          },
          [db.Sequelize.Op.or]: [
            db.sequelize.where(
              db.sequelize.col("last_dispatch_enqueued_at"),
              db.Sequelize.Op.is,
              null,
            ),
            db.sequelize.where(
              db.sequelize.col("last_dispatch_enqueued_at"),
              db.Sequelize.Op.lt,
              fiveMinutesAgo,
            ),
          ],
        },
      },
    );
    if (affected > 0) {
      logger.info(
        `[SEND-WORKER] Campaign ${campaign_id} marked completed (no pending recipients remaining)`,
      );
    }
  } catch (err) {
    logger.warn(
      `[SEND-WORKER] Failed to finalize campaign ${campaign_id}: ${err.message}`,
    );
  }
};

const flushTenantBuffers = async (tenantId) => {
  const buf = TENANT_BUFFERS.get(tenantId);
  if (!buf) return;
  if (buf.flushTimer) {
    clearTimeout(buf.flushTimer);
    buf.flushTimer = null;
  }
  const messages = buf.messages.splice(0, buf.messages.length);
  const recipientUpdates = buf.recipientUpdates.splice(
    0,
    buf.recipientUpdates.length,
  );
  const contactBackfills = buf.contactBackfills.splice(
    0,
    buf.contactBackfills.length,
  );
  // Clear deduplication set for flushed recipient IDs
  buf.recipientIdSet.clear();
  if (
    messages.length === 0 &&
    recipientUpdates.length === 0 &&
    contactBackfills.length === 0
  )
    return;
  try {
    if (contactBackfills.length > 0) {
      await batchUpdateRecipientContactIds(contactBackfills);
    }
    if (recipientUpdates.length > 0) {
      await batchUpdateRecipientStatuses(recipientUpdates);
      // After persisting statuses, finalize any campaigns that now have no
      // pending recipients left (all sent or permanently_failed).
      const campaignIds = Array.from(
        new Set(recipientUpdates.map((u) => u.campaign_id).filter(Boolean)),
      );
      for (const cid of campaignIds) {
        await finalizeCampaignIfComplete(cid);
      }
    }
    if (messages.length > 0) {
      await batchInsertMessages(messages);
    }
  } catch (err) {
    logger.error(
      `[SEND-WORKER] Error flushing DB buffers for tenant ${tenantId}: ${err.message}`,
    );
    // On failure, re-queue the buffers to attempt later
    buf.messages.unshift(...messages);
    buf.recipientUpdates.unshift(...recipientUpdates);
    buf.contactBackfills.unshift(...contactBackfills);
  }
};

// ── Error classification moved to metaErrorClassifier.js for centralized management

// ── Core processor ────────────────────────────────────────────────────────────

async function processSendJob(job) {
  const { campaign_id, tenant_id, recipient_id } = job.data;
  logger.info(
    `[SEND-WORKER] Sending message campaign=${campaign_id} tenant=${tenant_id} recipient=${recipient_id}`,
  );
  logger.info(
    `[SEND-WORKER] Executing job id=${job.id} campaign=${campaign_id} tenant=${tenant_id} recipient=${recipient_id} attempt=${job.attemptsMade + 1}`,
  );
  recordCampaignDiagnosticEvent({
    source: "send-worker",
    type: "worker_processed",
    message: `Send worker processing recipient=${recipient_id} campaign=${campaign_id}`,
    meta: {
      job_id: job.id,
      campaign_id,
      tenant_id,
      recipient_id,
      attempt: job.attemptsMade + 1,
    },
  });

  // Load campaign + template in one query
  const campaign = await db.WhatsappCampaigns.findOne({
    where: { campaign_id, tenant_id, is_deleted: false },
    include: [{ model: db.WhatsappTemplates, as: "template" }],
  });

  if (!campaign) {
    logger.warn(`[SEND-WORKER] Campaign ${campaign_id} not found — discarding`);
    return;
  }

  // Pause is honored at job start. Jobs that already passed this point may still
  // finish their Meta request; dispatch fan-out is what stops additional sends.
  if (["paused", "cancelled", "completed"].includes(campaign.status)) {
    logger.info(
      `[SEND-WORKER] Campaign ${campaign_id} is ${campaign.status} — discarding job`,
    );
    return;
  }

  if (!campaign.template) {
    logger.error(
      `[SEND-WORKER] Campaign ${campaign_id} has no template — discarding`,
    );
    return;
  }

  // Idempotency: skip if recipient is no longer pending (already sent or failed)
  const recipient = await db.WhatsappCampaignRecipients.findOne({
    where: { id: recipient_id, status: "pending", is_deleted: false },
  });

  if (!recipient) {
    logger.info(
      `[SEND-WORKER] Recipient ${recipient_id} no longer pending — skipping`,
    );
    return;
  }

  // ── Template components (from Redis cache with DB fallback) ───────────────────────────

  const redis = getRedisConnection();
  const campaignCache = getCampaignCache(redis);

  let components_data, carousel_data;

  // Try Redis cache first
  const cachedComponents = await campaignCache.getTemplateComponents(
    campaign.template_id,
  );
  const cachedCarousel = await campaignCache.getTemplateCarousel(
    campaign.template_id,
  );

  if (cachedComponents && cachedCarousel !== undefined) {
    components_data = cachedComponents;
    carousel_data = cachedCarousel;
    logger.debug(
      `[SEND-WORKER] Using cached template components for ${campaign.template_id}`,
    );
  } else {
    // Fallback to database and cache the result
    const templateData = await getTemplateComponents(campaign.template_id);
    components_data = templateData.components;
    carousel_data = templateData.carouselData;

    // Cache for future use (fire and forget)
    campaignCache
      .setTemplateComponents(campaign.template_id, components_data)
      .catch((err) =>
        logger.debug(
          `[SEND-WORKER] Failed to cache template components: ${err.message}`,
        ),
      );
    campaignCache
      .setTemplateCarousel(campaign.template_id, carousel_data)
      .catch((err) =>
        logger.debug(
          `[SEND-WORKER] Failed to cache template carousel: ${err.message}`,
        ),
      );
  }

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

  const campaignHeaderMediaUrl = campaign.header_media_url;

  let campaignLocationParams = campaign.location_params;
  let campaignCardMediaUrls = campaign.card_media_urls;

  if (typeof campaignLocationParams === "string") {
    try {
      campaignLocationParams = JSON.parse(campaignLocationParams);
    } catch {
      campaignLocationParams = null;
    }
  }
  if (typeof campaignCardMediaUrls === "string") {
    try {
      campaignCardMediaUrls = JSON.parse(campaignCardMediaUrls);
    } catch {
      campaignCardMediaUrls = null;
    }
  }

  // ── Parse dynamic variables ───────────────────────────────────────────────

  let dynamicVariables = recipient.dynamic_variables || [];
  if (typeof dynamicVariables === "string") {
    try {
      dynamicVariables = JSON.parse(dynamicVariables);
    } catch {
      dynamicVariables = [];
    }
  }

  try {
    // ── 1. Ensure Contact Exists ────────────────────────────────────────────

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
        recipient.contact_id = contactId;
        getTenantBuffer(tenant_id).contactBackfills.push({
          id: recipient_id,
          contact_id: contactId,
        });
      }
    }

    // ── 2. Ensure Lead Exists ───────────────────────────────────────────────

    if (contactId) {
      const existingLead = await getLeadByContactIdService(
        tenant_id,
        contactId,
      );
      if (!existingLead) {
        await createLeadService(tenant_id, contactId, "campaign");
      }
    }

    // ── 3. Build Message Components ─────────────────────────────────────────

    let components = [];

    // Authentication templates generate an OTP per recipient
    if (campaign.template?.category?.toLowerCase() === "authentication") {
      const existingOtp = job.data?.auth_otp || null;
      const otp =
        existingOtp ||
        (await generateWhatsAppOTPService(
          recipient.mobile_number,
          campaign.template.template_name,
        ));
      if (!existingOtp && typeof job.updateData === "function") {
        await job.updateData({ ...job.data, auth_otp: otp });
      }
      components.push({
        type: "body",
        parameters: [{ type: "text", text: otp }],
      });

      const [[authButtonsComp]] = await db.sequelize.query(
        `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
         WHERE template_id = ? AND component_type = 'buttons'`,
        { replacements: [campaign.template_id] },
      );
      if (authButtonsComp?.text_content) {
        try {
          const buttons = JSON.parse(authButtonsComp.text_content);
          const dynBtnIdx = buttons.findIndex(
            (btn) => btn.type === "URL" && btn.url?.includes("{{1}}"),
          );
          if (dynBtnIdx !== -1) {
            components.push({
              type: "button",
              sub_type: "url",
              index: String(dynBtnIdx),
              parameters: [{ type: "text", text: otp }],
            });
          }
        } catch {
          /* ignore parse errors */
        }
      }
    } else {
      // Object-structured variables: { body: [...], buttons: [...] }
      if (
        typeof dynamicVariables === "object" &&
        !Array.isArray(dynamicVariables) &&
        dynamicVariables !== null
      ) {
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
            if (btn?.parameters?.length > 0) {
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
        // Legacy array: treat as body parameters
        Array.isArray(dynamicVariables) &&
        dynamicVariables.length > 0
      ) {
        components.push({
          type: "body",
          parameters: dynamicVariables.map((v) => ({
            type: "text",
            text: String(v),
          })),
        });
      }
    }

    // ── 4. Header Component (Media or Location) ─────────────────────────────

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
          const isNumericId = mediaId && /^\d+$/.test(mediaId);
          if (campaignHeaderMediaUrl) {
            mediaObj = { link: campaignHeaderMediaUrl };
          } else if (isNumericId) {
            mediaObj = { id: mediaId };
          } else {
            throw Object.assign(
              new Error(
                "Document header requires a public media URL. No valid URL is available for sending.",
              ),
              { validation: true },
            );
          }
          mediaObj.filename = campaign.header_file_name || "document.pdf";
        } else {
          const isNumericId = mediaId && /^\d+$/.test(mediaId);
          if (campaignHeaderMediaUrl) {
            mediaObj = { link: campaignHeaderMediaUrl };
          } else if (isNumericId) {
            mediaObj = { id: mediaId };
          } else {
            throw Object.assign(
              new Error(
                `${hFormat} header requires a public media URL. No valid URL is available for sending.`,
              ),
              { validation: true },
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
      } else if (hFormat === "LOCATION" && campaignLocationParams) {
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

    // ── 5. Carousel Component ───────────────────────────────────────────────

    if (carousel_data.length > 0 && campaignCardMediaUrls) {
      try {
        const carouselComp = JSON.parse(carousel_data[0].text_content);
        if (carouselComp.cards && Array.isArray(carouselComp.cards)) {
          const cardsPayload = carouselComp.cards.map((card, idx) => {
            const cardComponents = [];
            const cardMediaUrl = campaignCardMediaUrls[idx];
            const cardHeader = card.components?.find(
              (c) => c.type === "HEADER",
            );
            if (
              cardHeader &&
              ["IMAGE", "VIDEO"].includes(cardHeader.format) &&
              !cardMediaUrl
            ) {
              throw Object.assign(
                new Error(
                  `Missing carousel media for card ${idx + 1} (${cardHeader.format}) in campaign ${campaign_id}`,
                ),
                { validation: true },
              );
            }
            if (
              cardHeader &&
              ["IMAGE", "VIDEO"].includes(cardHeader.format) &&
              cardMediaUrl
            ) {
              cardComponents.push({
                type: "header",
                parameters: [
                  {
                    type: cardHeader.format.toLowerCase(),
                    [cardHeader.format.toLowerCase()]: { link: cardMediaUrl },
                  },
                ],
              });
            }
            return { index: idx, components: cardComponents };
          });
          components.push({ type: "carousel", cards: cardsPayload });
        }
      } catch (carouselErr) {
        const rawSummary = String(carousel_data[0]?.text_content || "").slice(
          0,
          500,
        );
        logger.warn(
          `[SEND-WORKER] Carousel payload parse/build failed campaign=${campaign_id} recipient=${recipient_id}: ${carouselErr.message}. payload_sample=${rawSummary}`,
        );
        throw Object.assign(
          new Error(`Invalid carousel payload: ${carouselErr.message}`),
          { validation: true, permanent: true },
        );
      }
    }

    // ── 6. Pre-send Validation ──────────────────────────────────────────────

    const formattedPhone = formatPhoneNumber(recipient.mobile_number);
    if (!formattedPhone) {
      throw Object.assign(
        new Error(
          `Invalid phone number "${recipient.mobile_number}" — must be either a 10-digit local number or a 12-digit country+number`,
        ),
        { validation: true, permanent: true },
      );
    }

    const expectedVarCount = (templateBodyText.match(/{{\d+}}/g) || []).reduce(
      (set, m) => set.add(m),
      new Set(),
    ).size;

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
            `Variable mismatch — template expects ${expectedVarCount} variable(s) but recipient has ${sentVarCount} (mobile=${recipient.mobile_number})`,
          ),
          { validation: true, permanent: true },
        );
      }
    }

    if (
      headerComponent &&
      ["IMAGE", "VIDEO", "DOCUMENT"].includes(
        headerComponent.header_format?.toUpperCase(),
      )
    ) {
      const hasUrl = !!campaignHeaderMediaUrl;
      const hasNumericId =
        campaign.media_handle && /^\d+$/.test(String(campaign.media_handle));
      if (!hasUrl && !hasNumericId) {
        throw Object.assign(
          new Error(
            `Missing media — template header requires ${headerComponent.header_format} but no valid URL or media ID available`,
          ),
          { validation: true },
        );
      }
    }

    // Send through Meta and capture wamid for webhook correlation.

    const circuitBreaker = getMetaApiCircuitBreaker(sendWhatsAppTemplate);

    // B-1: Acquire per-recipient Redis lock to prevent double-sends on race/retry
    const sendLockKey = `send-lock:${recipient_id}`;
    const SEND_LOCK_TTL = 60; // seconds — enough for send + buffer write
    const redisLock = getRedisLock(redis);
    const lockResult = await redisLock.acquireWithRetry(
      sendLockKey,
      SEND_LOCK_TTL,
      3, // retries
    );

    if (!lockResult.success) {
      logger.warn(
        `[SEND-WORKER] Failed to acquire send lock for recipient ${recipient_id} — retrying later`,
      );
      const lockErr = new Error(
        "Could not acquire send lock (possible concurrent send in progress)",
      );
      lockErr.code = "SEND_LOCK_BUSY";
      throw lockErr;
    }

    const { release: releaseSendLock } = lockResult;

    try {
      // ── Send through Meta ──
      const sendResult = await circuitBreaker.execute(
        tenant_id,
        formattedPhone,
        campaign.template.template_name,
        campaign.template.language,
        components,
        {
          campaign_id,
          recipient_id,
        },
      );

      // ── 8. Buffer recipient status + message insert for batched DB writes ──
      let personalizedMessage = templateBodyText;
      const bodyVars = Array.isArray(dynamicVariables)
        ? dynamicVariables
        : typeof dynamicVariables === "object" &&
            dynamicVariables !== null &&
            Array.isArray(dynamicVariables.body)
          ? dynamicVariables.body
          : [];
      bodyVars.forEach((val, idx) => {
        personalizedMessage = personalizedMessage.replace(
          `{{${idx + 1}}}`,
          val,
        );
      });

      let finalMessageType = "template";
      let finalMediaUrl = null;
      if (
        headerFormat &&
        ["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat.toUpperCase())
      ) {
        finalMessageType = headerFormat.toLowerCase();
        finalMediaUrl = campaignHeaderMediaUrl || null;
        personalizedMessage = finalMediaUrl
          ? `[${headerFormat.toUpperCase()}: ${finalMediaUrl}]\n${personalizedMessage}`
          : `[${headerFormat.toUpperCase()}]\n${personalizedMessage}`;
      }

      if (footerComponent?.text_content)
        personalizedMessage += "\n" + footerComponent.text_content;

      if (buttonsComponent?.text_content) {
        try {
          const buttons = JSON.parse(buttonsComponent.text_content);
          if (Array.isArray(buttons)) {
            buttons.forEach((btn) => {
              let btnLabel = btn.text;
              if (btn.type === "URL" && btn.url) btnLabel += ` (${btn.url})`;
              else if (btn.type === "PHONE_NUMBER" && btn.phone_number)
                btnLabel += ` (${btn.phone_number})`;
              personalizedMessage += `\n[Button: ${btnLabel}]`;
            });
          }
        } catch {}
      }

      let campaignMediaMimeType = null;
      if (finalMessageType === "document" && campaign.header_file_name) {
        const ext = campaign.header_file_name.split(".").pop()?.toLowerCase();
        const mimeMap = {
          pdf: "application/pdf",
          doc: "application/msword",
          docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          xls: "application/vnd.ms-excel",
          xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };
        campaignMediaMimeType = mimeMap[ext] || "application/octet-stream";
      }

      const metaMessageId = sendResult?.meta_message_id ?? null;

      const messageRow = {
        tenant_id,
        contact_id: contactId || null,
        phone_number_id: null,
        country_code: null,
        phone: recipient.mobile_number,
        wamid: metaMessageId,
        name: "System",
        sender: "admin",
        sender_id: null,
        message: personalizedMessage,
        message_type: finalMessageType,
        media_url: finalMediaUrl,
        media_mime_type: campaignMediaMimeType,
        status: "sent",
        template_name: campaign.template.template_name || null,
        interactive_payload: null,
        media_filename:
          finalMessageType === "document"
            ? campaign.header_file_name || null
            : null,
      };

      const recipientUpdate = {
        id: recipient_id,
        campaign_id: campaign_id,
        status: "sent",
        meta_message_id: metaMessageId,
        error_message: null,
        retry_count: null,
        next_retry_at: null,
      };

      const tId = String(tenant_id);
      const buf = getTenantBuffer(tId);
      buf.messages.push(messageRow);

      // B-1: Deduplication — last-write-wins per recipient_id
      if (buf.recipientIdSet.has(recipient_id)) {
        const prevIdx = buf.recipientUpdates.findIndex(
          (u) => u.id === recipient_id,
        );
        if (prevIdx >= 0) {
          buf.recipientUpdates.splice(prevIdx, 1);
        }
      }
      buf.recipientIdSet.add(recipient_id);
      buf.recipientUpdates.push(recipientUpdate);

      if (
        buf.messages.length >= DB_BATCH_SIZE ||
        buf.recipientUpdates.length >= DB_BATCH_SIZE ||
        buf.contactBackfills.length >= DB_BATCH_SIZE
      ) {
        flushTenantBuffers(tId).catch((flushErr) =>
          logger.warn(
            `[SEND-WORKER] Threshold flush failed for tenant ${tId}: ${flushErr.message}`,
          ),
        );
      } else {
        scheduleTenantFlush(tId);
      }

      // Fire-and-forget livechat updates (do not block send path)
      if (contactId) {
        (async () => {
          try {
            const livelist = await getLivechatByIdService(tenant_id, contactId);
            if (!livelist) {
              await createLiveChatService(tenant_id, contactId);
            } else {
              await updateLiveChatTimestampService(tenant_id, contactId);
            }
          } catch (e) {
            logger.debug(
              `[SEND-WORKER] LiveChat update failed (tenant=${tenant_id} contact=${contactId}): ${e.message}`,
            );
          }
        })();
      }

      logger.info(
        `[SEND-WORKER] Buffered sent — campaign=${campaign_id} recipient=${recipient_id} phone=${formattedPhone}`,
      );
    } catch (error) {
      // B-1: On send error, release lock and re-throw for outer catch
      try {
        await releaseSendLock();
      } catch (releasErr) {
        logger.warn(
          `[SEND-WORKER] Failed to release send lock on error for recipient ${recipient_id}: ${releasErr.message}`,
        );
      }
      throw error;
    } finally {
      // B-1: Backup lock release (in case lock wasn't released in catch)
      try {
        await releaseSendLock();
      } catch (finalErr) {
        // Silently ignore — lock may have already been released
      }
    }

    // Emit diagnostic event
    recordCampaignDiagnosticEvent({
      source: "send-worker",
      type: "worker_processed",
      message: `Recipient buffered campaign=${campaign_id} recipient=${recipient_id}`,
      meta: { campaign_id, tenant_id, recipient_id, phone: formattedPhone },
    });
  } catch (err) {
    // Classify the error using numeric Meta error codes
    const isPermErr = isFinallyPermanent(err);

    // Auth/config errors (expired token, wrong permissions) are tenant-level —
    // the same broken token affects ALL campaigns for this tenant. Pause every
    // active campaign at once so 1000 campaigns don't each hit Meta, fail, and
    // get paused one by one.
    if (isMetaAuthConfigError(err)) {
      const errorMsg = formatErrorForLogging(err);
      logger.error(
        `[SEND-WORKER] Auth/config error for tenant ${tenant_id} campaign ${campaign_id} recipient ${recipient_id}: ${errorMsg} — pausing ALL active campaigns for tenant`,
      );

      const pausedReason = `WhatsApp API access error: ${errorMsg}. Please update your WhatsApp access token in Settings.`;

      try {
        const [affectedRows] = await db.WhatsappCampaigns.update(
          {
            status: "paused",
            paused_reason: pausedReason,
          },
          {
            where: {
              tenant_id,
              status: "active",
              is_deleted: false,
            },
          },
        );
        if (affectedRows > 0) {
          logger.warn(
            `[SEND-WORKER] ${affectedRows} campaign(s) paused for tenant ${tenant_id} due to auth/config error`,
          );
          try {
            const io = getIO();
            io.to(`tenant-${tenant_id}`).emit("campaign_paused", {
              campaign_id: null,
              status: "paused",
              paused_reason: pausedReason,
              all_campaigns: true,
              affected_count: affectedRows,
            });
            io.to(`tenant-${tenant_id}`).emit("campaign-status-update", {
              campaign_id,
              status: "paused",
              paused_reason: pausedReason,
            });
          } catch (_) {
            /* socket emit is best-effort */
          }
        }
      } catch (pauseErr) {
        logger.error(
          `[SEND-WORKER] Failed to pause campaigns for tenant ${tenant_id} on auth error: ${pauseErr.message}`,
        );
      }

      return; // do NOT throw — job is done, campaigns are paused
    }

    if (isPermErr) {
      // Create structured error object for storage
      const structuredError = createStructuredError(err);
      const errorJson = JSON.stringify(structuredError);

      // Mark permanently failed right now — buffer update so many updates are batched
      logger.warn(
        `[SEND-WORKER] Permanent failure for recipient ${recipient_id}: ${formatErrorForLogging(err)}`,
      );
      const tId = String(tenant_id);
      const buf = getTenantBuffer(tId);
      buf.recipientUpdates.push({
        id: recipient_id,
        campaign_id: campaign_id,
        status: "permanently_failed",
        error_message: structuredError.message, // Human-readable message
        last_error: errorJson, // Full structured error as JSON
        retry_count: 3,
        next_retry_at: null,
      });
      // Flush immediately to persist permanent failure
      await flushTenantBuffers(tId);
      return; // do NOT throw — BullMQ will treat this as a successful job
    }

    // Retryable — throw so BullMQ retries with configured backoff
    logger.warn(
      `[SEND-WORKER] Retryable failure for recipient ${recipient_id} (attempt ${job.attemptsMade + 1}): ${formatErrorForLogging(err)}`,
    );
    recordCampaignDiagnosticEvent({
      source: "send-worker",
      type: "error",
      level: "warn",
      message: `Retryable failure recipient=${recipient_id}: ${err.message}`,
      meta: {
        campaign_id,
        tenant_id,
        recipient_id,
        attempt: job.attemptsMade + 1,
        error_code: err.code || null,
      },
    });
    throw err;
  }
}

// ── Worker lifecycle ──────────────────────────────────────────────────────────

const sendWorkers = new Map();

const markRecipientPermanentlyFailed = async (
  recipientId,
  errorMessage,
  campaign_id = null,
  errorData = null,
) => {
  try {
    await db.WhatsappCampaignRecipients.update(
      {
        status: "permanently_failed",
        error_message: errorMessage,
        last_error: errorData || errorMessage, // Store structured error if available, fall back to message
        retry_count: 3,
        next_retry_at: null,
      },
      { where: { id: recipientId } },
    );
  } catch (updateErr) {
    logger.error(
      `[SEND-WORKER] Could not mark recipient ${recipientId} permanently_failed: ${updateErr.message}`,
    );
    return;
  }

  // The retry-exhaustion path bypasses the buffered flush, so finalize the
  // campaign here too — otherwise a campaign whose last recipients fail via
  // retries would stay "active" forever.
  await finalizeCampaignIfComplete(campaign_id);
};

const pushFailedJobToTenantDlq = async (tenantId, job, err) => {
  try {
    const dlq = getTenantDLQ(tenantId);
    const sourceJobId = String(
      job?.id || `${job?.data?.recipient_id || "unknown"}:${Date.now()}`,
    );
    const dlqJobId = `dlq-${sourceJobId.replace(/:/g, "-")}`;
    await dlq.add(
      "campaign-send-dlq",
      {
        tenant_id: tenantId,
        original_queue: getTenantQueueName(tenantId),
        failed_at: new Date().toISOString(),
        reason: err.message,
        attempts_made: job.attemptsMade,
        job_id: job.id,
        payload: job.data,
      },
      {
        jobId: dlqJobId,
      },
    );
  } catch (dlqErr) {
    logger.error(
      `[SEND-WORKER] Failed to move job ${job?.id} to tenant DLQ ${tenantId}: ${dlqErr.message}`,
    );
  }
};

const logExhaustedSystemFailure = async (tenantId, job, err) => {
  const campaignId = job?.data?.campaign_id || null;
  const recipientId = job?.data?.recipient_id || null;
  const attemptsMade = Number(job?.attemptsMade || 0);
  const structuredError = createStructuredError(err);
  let recipientStatusAction = "not_updated";

  if (recipientId) {
    try {
      const [affectedRows] = await db.WhatsappCampaignRecipients.update(
        {
          status: "permanently_failed",
          error_message: structuredError.message,
          last_error: JSON.stringify(structuredError),
          retry_count: attemptsMade,
          next_retry_at: null,
        },
        {
          where: {
            id: recipientId,
            status: "pending",
            is_deleted: false,
          },
        },
      );
      if (affectedRows === 1) {
        recipientStatusAction = "marked_permanently_failed";
        await finalizeCampaignIfComplete(campaignId);
      } else {
        recipientStatusAction = "skipped_non_pending";
        logger.warn(
          `[SEND-WORKER] Exhausted system/network failure did not update recipient ${recipientId} because it is no longer pending`,
        );
      }
    } catch (updateErr) {
      logger.error(
        `[SEND-WORKER] Could not persist exhausted system/network failure for recipient ${recipientId}: ${updateErr.message}`,
      );
    }
  }

  logger.error(
    `[SEND-WORKER] Retries exhausted for system/network failure tenant=${tenantId} campaign=${campaignId} recipient=${recipientId} attempts=${attemptsMade} code=${err.code || "n/a"} message=${err.message}. recipient_status_action=${recipientStatusAction}.`,
  );
  recordCampaignDiagnosticEvent({
    source: "send-worker",
    type: "error",
    level: "error",
    message: `System/network failure after retries tenant=${tenantId} recipient=${recipientId}: ${err.message}`,
    meta: {
      tenant_id: tenantId,
      campaign_id: campaignId,
      job_id: job?.id || null,
      recipient_id: recipientId,
      error_code: err.code || null,
      error_message: err.message,
      retry_count: attemptsMade,
      recipient_status_action: recipientStatusAction,
    },
  });
};

const pauseCampaignForAuthConfigError = async (tenantId, job, err) => {
  const campaignId = job?.data?.campaign_id || null;
  const recipientId = job?.data?.recipient_id || null;
  if (!campaignId) return false;

  const reason = `Meta authorization/configuration error: ${err.message}`;
  const [affectedRows] = await db.WhatsappCampaigns.update(
    {
      status: "paused",
      paused_reason: reason,
    },
    {
      where: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        is_deleted: false,
      },
    },
  );

  logger.error(
    `[SEND-WORKER] Campaign paused after Meta auth/config failure tenant=${tenantId} campaign=${campaignId} recipient=${recipientId} status=${err.meta_response_status || "n/a"} code=${err.meta_error_code || "n/a"} message=${err.message}`,
  );
  recordCampaignDiagnosticEvent({
    source: "send-worker",
    type: "error",
    level: "error",
    message: `Campaign paused for Meta auth/config failure campaign=${campaignId} recipient=${recipientId}: ${err.message}`,
    meta: {
      tenant_id: tenantId,
      campaign_id: campaignId,
      job_id: job?.id || null,
      recipient_id: recipientId,
      meta_response_status: err.meta_response_status || null,
      meta_error_code: err.meta_error_code || null,
      recipient_status_action: "left_pending",
      campaign_status_action: affectedRows > 0 ? "paused" : "pause_not_applied",
    },
  });

  return affectedRows > 0;
};

const createTenantSendWorker = (tenantId) => {
  if (sendWorkers.has(tenantId)) {
    return sendWorkers.get(tenantId);
  }

  const connection = getRedisConnection();
  const queueName = getTenantQueueName(tenantId);
  const perTenantConcurrency = parseInt(
    process.env.CAMPAIGN_SEND_CONCURRENCY || "20",
    10,
  );
  const metaRatePerSecond = parseInt(
    process.env.CAMPAIGN_META_RATE_PER_SEC || "80",
    10,
  );
  const workerLimiter = {
    max:
      Number.isFinite(metaRatePerSecond) && metaRatePerSecond > 0
        ? metaRatePerSecond
        : 80,
    duration: 1000,
  };

  const worker = new Worker(queueName, processSendJob, {
    connection,
    concurrency: perTenantConcurrency,
    limiter: workerLimiter,
  });

  worker.on("failed", async (job, err) => {
    if (!job) return;

    // Create structured error object for logging and storage
    const structuredError = createStructuredError(err);

    logger.error(
      `[SEND-WORKER] All retries exhausted for tenant ${tenantId} job ${job.id} (recipient=${job.data.recipient_id}): ${formatErrorForLogging(err)}`,
    );
    recordCampaignDiagnosticEvent({
      source: "send-worker",
      type: "error",
      level: "error",
      message: `Retries exhausted tenant=${tenantId} recipient=${job.data.recipient_id}: ${formatErrorForLogging(err)}`,
      meta: {
        tenant_id: tenantId,
        job_id: job.id,
        recipient_id: job.data.recipient_id,
        error_code: structuredError.code,
        error_subcode: structuredError.subcode,
      },
    });

    if (!isFinallyPermanent(err)) {
      if (isMetaAuthConfigError(err)) {
        // Auth/config errors are tenant-level — pause ALL active campaigns
        // to match the inline catch behavior and avoid 1000 campaigns each
        // retrying against a broken token.
        const reason = `WhatsApp API access error: ${formatErrorForLogging(err)}. Please update your WhatsApp access token in Settings.`;
        try {
          const [affectedRows] = await db.WhatsappCampaigns.update(
            { status: "paused", paused_reason: reason },
            {
              where: {
                tenant_id: tenantId,
                status: "active",
                is_deleted: false,
              },
            },
          );
          if (affectedRows > 0) {
            logger.error(
              `[SEND-WORKER] ${affectedRows} campaign(s) paused for tenant ${tenantId} after retry exhaustion auth error: ${formatErrorForLogging(err)}`,
            );
          }
        } catch (pauseErr) {
          logger.error(
            `[SEND-WORKER] Failed to pause tenant ${tenantId} campaigns on retry-exhaustion auth error: ${pauseErr.message}`,
          );
        }
        await pushFailedJobToTenantDlq(tenantId, job, err);
        return;
      }

      await logExhaustedSystemFailure(tenantId, job, err);
      await pushFailedJobToTenantDlq(tenantId, job, err);
      return;
    }

    await markRecipientPermanentlyFailed(
      job.data.recipient_id,
      structuredError.message,
      job.data.campaign_id,
      JSON.stringify(structuredError),
    );
    await pushFailedJobToTenantDlq(tenantId, job, err);
  });

  worker.on("error", (err) => {
    logger.error(
      `[SEND-WORKER] Worker error (tenant=${tenantId}, queue=${queueName}): ${err.message}`,
    );
  });

  sendWorkers.set(tenantId, worker);
  logger.info(
    `[SEND-WORKER] Started tenant worker queue=${queueName} concurrency=${perTenantConcurrency} limiter=${workerLimiter.max}/${workerLimiter.duration}ms`,
  );
  recordCampaignDiagnosticEvent({
    source: "send-worker",
    type: "worker_started",
    message: `Tenant send worker started queue=${queueName}`,
    meta: {
      tenant_id: tenantId,
      queue_name: queueName,
      concurrency: perTenantConcurrency,
      tenant_limit: workerLimiter.max,
      rate_duration: workerLimiter.duration,
    },
  });
  // Initialize per-tenant buffers
  getTenantBuffer(tenantId);
  return worker;
};

export const ensureTenantSendWorker = (tenant_id) => {
  if (!isCampaignQueueAvailable()) return null;

  const tenantId = String(tenant_id || "").trim();
  if (!tenantId) {
    logger.warn(
      "[SEND-WORKER] ensureTenantSendWorker called without tenant_id",
    );
    return null;
  }

  if (sendWorkers.has(tenantId)) {
    return sendWorkers.get(tenantId);
  }

  return createTenantSendWorker(tenantId);
};

export const startCampaignSendWorker = () => {
  if (!isCampaignQueueAvailable()) {
    logger.warn(
      "[SEND-WORKER] Campaign queue unavailable — worker not started (cron handles execution)",
    );
    return;
  }

  logger.info(
    "[SEND-WORKER] Tenant worker manager started. Workers will be created lazily per tenant queue.",
  );
};

export const closeSendWorker = async () => {
  for (const [tenantId, worker] of sendWorkers.entries()) {
    try {
      // Flush any pending buffers for tenant before closing
      try {
        await flushTenantBuffers(tenantId);
      } catch (e) {
        logger.warn(
          `[SEND-WORKER] flush before close failed for ${tenantId}: ${e.message}`,
        );
      }
      await worker.close();
      logger.info(`[SEND-WORKER] Closed worker for tenant ${tenantId}`);
    } catch (err) {
      logger.warn(
        `[SEND-WORKER] Failed to close worker for tenant ${tenantId}: ${err.message}`,
      );
    }
  }
  sendWorkers.clear();
};

export const getSendWorkerStatus = () => {
  const tenants = Array.from(sendWorkers.keys());
  return {
    running: sendWorkers.size > 0,
    worker_type: "campaign-send-tenant",
    active_worker_count: sendWorkers.size,
    active_tenant_ids: tenants,
  };
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const startStandaloneWorker = async () => {
    await initCampaignQueues();

    if (!isCampaignQueueAvailable()) {
      logger.error(
        "[SEND-WORKER] Campaign queue unavailable. Check REDIS_URL and Redis service before starting worker.",
      );
      process.exit(1);
    }

    startCampaignSendWorker();

    // Pre-create tenant workers so queue worker discovery can see active workers immediately.
    const tenants = await db.Tenants.findAll({
      where: { is_deleted: false },
      attributes: ["tenant_id"],
      raw: true,
    });

    for (const tenant of tenants) {
      ensureTenantSendWorker(tenant.tenant_id);
    }

    process.on("SIGINT", async () => {
      await closeSendWorker();
      process.exit(0);
    });

    process.stdin.resume();
  };

  startStandaloneWorker().catch((err) => {
    logger.error(
      `[SEND-WORKER] Failed to start standalone worker: ${err.message}`,
    );
    process.exit(1);
  });
}
