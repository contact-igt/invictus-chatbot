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
import { logger } from "../utils/logger.js";
import {
  getRedisConnection,
  getTenantDLQ,
  getTenantQueueName,
  getTenantRateLimit,
  isCampaignQueueAvailable,
} from "../queues/campaignQueue.js";
import { getTemplateComponents } from "../utils/templateCache.js";
import { getCampaignCache } from "../utils/redis/redisCache.js";
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Errors that will never succeed on retry — do not let BullMQ retry these.
const PERMANENT_ERROR_PATTERNS = [
  "healthy ecosystem",
  "not delivered",
  "spam",
  "blocked",
  "recipient not on whatsapp",
  "incapable of receiving",
  "re-engage",
  "invalid phone",
  "variable mismatch",
  "missing media",
  "no valid url",
];

const isFinallyPermanent = (err) => {
  const lower = String(err?.message || "").toLowerCase();
  // Errors explicitly flagged permanent by build logic
  if (err?.validation === true) return true;
  return PERMANENT_ERROR_PATTERNS.some((p) => lower.includes(p));
};

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

  // Respect paused / cancelled — discard without marking failed
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
      if (contactId) await recipient.update({ contact_id: contactId });
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
      const otp = await generateWhatsAppOTPService(
        recipient.mobile_number,
        campaign.template.template_name,
      );
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
      } catch {
        /* ignore carousel parse errors */
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

    // ── Send via Meta API (with circuit breaker protection) ────────────────────────────────────────────────

    const circuitBreaker = getMetaApiCircuitBreaker(sendWhatsAppTemplate);

    let result;
    try {
      result = await circuitBreaker.execute(
        tenant_id,
        formattedPhone,
        campaign.template.template_name,
        campaign.template.language,
        components,
      );
    } catch (sendErr) {
      const errMsg = String(sendErr?.message || "");

      // Unhealthy API (503) — pause 30 s then retry once before propagating
      const isUnhealthy =
        errMsg.toLowerCase().includes("unhealthy") ||
        errMsg.toLowerCase().includes("service unavailable") ||
        errMsg.toLowerCase().includes("503");

      if (isUnhealthy) {
        logger.warn(
          `[SEND-WORKER] Unhealthy API — pausing 30 s before retry (${formattedPhone})`,
        );
        await sleep(30000);
        result = await sendWhatsAppTemplate(
          tenant_id,
          formattedPhone,
          campaign.template.template_name,
          campaign.template.language,
          components,
        );
      } else {
        // Invalid media ID — retry once with public URL fallback
        const hasInvalidMediaId =
          errMsg.includes(
            "is not a valid whatsapp business account media attachment ID",
          ) ||
          errMsg.includes(
            "template['components'][0]['parameters'][0]['image']['id']",
          ) ||
          (errMsg.includes("JSON schema constraint") && errMsg.includes(".id"));

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
              if (param.type === "image" && param.image?.id)
                return { ...param, image: { link: campaignHeaderMediaUrl } };
              if (param.type === "video" && param.video?.id)
                return { ...param, video: { link: campaignHeaderMediaUrl } };
              if (param.type === "document" && param.document?.id)
                return {
                  ...param,
                  document: {
                    link: campaignHeaderMediaUrl,
                    ...(campaign.header_file_name
                      ? { filename: campaign.header_file_name }
                      : {}),
                  },
                };
              return param;
            });
            return { ...component, parameters: nextParams };
          });

          logger.warn(
            `[SEND-WORKER] Invalid media ID — retrying with public URL (${formattedPhone})`,
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

    // ── 8. Update recipient status ──────────────────────────────────────────

    await recipient.update({
      status: "sent",
      meta_message_id: result.meta_message_id || null,
      error_message: null,
    });

    // ── 9. Log to Messages table + activate LiveChat ────────────────────────

    if (contactId && result.meta_message_id) {
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

      if (footerComponent?.text_content) {
        personalizedMessage += "\n" + footerComponent.text_content;
      }

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
        } catch {
          /* ignore */
        }
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

      const livelist = await getLivechatByIdService(tenant_id, contactId);
      if (!livelist) {
        await createLiveChatService(tenant_id, contactId);
      } else {
        await updateLiveChatTimestampService(tenant_id, contactId);
      }
    }

    logger.info(
      `[SEND-WORKER] Sent — campaign=${campaign_id} recipient=${recipient_id} phone=${formattedPhone}`,
    );

    const remainingRecipients = await db.WhatsappCampaignRecipients.count({
      where: { campaign_id, status: "pending", is_deleted: false },
    });

    logger.info(
      `[SEND-WORKER] campaign_id=${campaign_id} remaining_pending=${remainingRecipients} status=${campaign.status}`,
    );

    if (remainingRecipients === 0) {
      await db.WhatsappCampaigns.update(
        { status: "completed" },
        {
          where: {
            campaign_id,
            tenant_id,
            status: { [db.Sequelize.Op.in]: ["active", "scheduled", "failed"] },
            is_deleted: false,
          },
        },
      );
      logger.info(
        `[SEND-WORKER] Campaign ${campaign_id} marked completed (remaining_pending=0)`,
      );
    }

    recordCampaignDiagnosticEvent({
      source: "send-worker",
      type: "worker_processed",
      message: `Recipient sent campaign=${campaign_id} recipient=${recipient_id}`,
      meta: { campaign_id, tenant_id, recipient_id, phone: formattedPhone },
    });
  } catch (err) {
    // Classify the error
    const isPermErr = isFinallyPermanent(err);

    if (isPermErr) {
      // Mark permanently failed right now — never retry
      logger.warn(
        `[SEND-WORKER] Permanent failure for recipient ${recipient_id}: ${err.message}`,
      );
      await recipient.update({
        status: "permanently_failed",
        error_message: err.message,
        last_error: err.message,
        retry_count: 3,
        next_retry_at: null,
      });
      return; // do NOT throw — BullMQ will treat this as a successful job
    }

    // Retryable — throw so BullMQ retries with configured backoff
    logger.warn(
      `[SEND-WORKER] Retryable failure for recipient ${recipient_id} (attempt ${job.attemptsMade + 1}): ${err.message}`,
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
      },
    });
    throw err;
  }
}

// ── Worker lifecycle ──────────────────────────────────────────────────────────

const sendWorkers = new Map();

const markRecipientPermanentlyFailed = async (recipientId, errorMessage) => {
  try {
    await db.WhatsappCampaignRecipients.update(
      {
        status: "permanently_failed",
        error_message: errorMessage,
        last_error: errorMessage,
        retry_count: 3,
        next_retry_at: null,
      },
      { where: { id: recipientId } },
    );
  } catch (updateErr) {
    logger.error(
      `[SEND-WORKER] Could not mark recipient ${recipientId} permanently_failed: ${updateErr.message}`,
    );
  }
};

const pushFailedJobToTenantDlq = async (tenantId, job, err) => {
  try {
    const dlq = getTenantDLQ(tenantId);
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
        jobId: `dlq:${job.id || `${job.data?.recipient_id}:${Date.now()}`}`,
      },
    );
  } catch (dlqErr) {
    logger.error(
      `[SEND-WORKER] Failed to move job ${job?.id} to tenant DLQ ${tenantId}: ${dlqErr.message}`,
    );
  }
};

const createTenantSendWorker = (tenantId) => {
  if (sendWorkers.has(tenantId)) {
    return sendWorkers.get(tenantId);
  }

  const connection = getRedisConnection();
  const queueName = getTenantQueueName(tenantId);
  const perTenantConcurrency = parseInt(
    process.env.CAMPAIGN_SEND_CONCURRENCY_PER_TENANT || "5",
    10,
  );
  const rateDuration = parseInt(
    process.env.CAMPAIGN_SEND_RATE_DURATION || "60000",
    10,
  );
  const tenantLimit = getTenantRateLimit(tenantId);

  const worker = new Worker(queueName, processSendJob, {
    connection,
    concurrency: perTenantConcurrency,
    limiter: { max: tenantLimit, duration: rateDuration },
  });

  worker.on("failed", async (job, err) => {
    if (!job) return;

    logger.error(
      `[SEND-WORKER] All retries exhausted for tenant ${tenantId} job ${job.id} (recipient=${job.data.recipient_id}): ${err.message}`,
    );
    recordCampaignDiagnosticEvent({
      source: "send-worker",
      type: "error",
      level: "error",
      message: `Retries exhausted tenant=${tenantId} recipient=${job.data.recipient_id}: ${err.message}`,
      meta: {
        tenant_id: tenantId,
        job_id: job.id,
        recipient_id: job.data.recipient_id,
      },
    });

    await markRecipientPermanentlyFailed(job.data.recipient_id, err.message);
    await pushFailedJobToTenantDlq(tenantId, job, err);
  });

  worker.on("error", (err) => {
    logger.error(
      `[SEND-WORKER] Worker error (tenant=${tenantId}, queue=${queueName}): ${err.message}`,
    );
  });

  sendWorkers.set(tenantId, worker);
  logger.info(
    `[SEND-WORKER] Started tenant worker queue=${queueName} concurrency=${perTenantConcurrency} limiter=${tenantLimit}/${rateDuration}ms`,
  );
  recordCampaignDiagnosticEvent({
    source: "send-worker",
    type: "worker_started",
    message: `Tenant send worker started queue=${queueName}`,
    meta: {
      tenant_id: tenantId,
      queue_name: queueName,
      concurrency: perTenantConcurrency,
      tenant_limit: tenantLimit,
      rate_duration: rateDuration,
    },
  });
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
