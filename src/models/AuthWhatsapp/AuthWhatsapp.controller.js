import { createUserMessageService } from "../Messages/messages.service.js";
import { downloadAndStoreIncomingMedia } from "../../services/chatAttachmentService.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";
import fs from "fs";
import os from "os";
import {
  getOpenAIReply,
  getOpenAIVisionReply,
  sendWhatsAppMessage,
  sendTypingIndicator,
  sendReadReceipt,
  unlockChat,
  tryAcquireLock,
  tryMarkMessageProcessed,
  queuePendingMessage,
  consumePendingMessage,
} from "./AuthWhatsapp.service.js";
import {
  handleAppointmentIntent as handleLegacyAppointmentIntent,
  handleConfirmation as handleLegacyAppointmentConfirmation,
} from "../AppointmentModel/appointmentConversation.service.js";
import {
  buildAvailableDoctorListAppointmentResponse,
  handleAdvancedAppointmentBooking,
} from "../AppointmentModel/Advanced_Appointment_Booking.service.js";
import {
  APPOINTMENT_BOOKING_TYPES,
  getAppointmentBookingAutomationSettings,
  handleAppointmentBookingAiAgent,
  shouldUseAppointmentAiAgent,
} from "../AppointmentModel/appointmentBookingAiAgent.service.js";
import {
  handleManageBookedAppointments,
  hasActiveManageAppointmentSession,
} from "../AppointmentModel/Manage_Booked_Appointments.service.js";
import {
  cancelAppointmentSession,
  getActiveAppointmentSession,
  isSessionExpired,
} from "../AppointmentModel/appointmentSession.service.js";
import {
  clearManageAppointmentSession,
  MANAGE_APPOINTMENT_SESSION_STATUS,
} from "../AppointmentModel/manageAppointmentSession.service.js";
import { releaseLockedSlots } from "../AppointmentModel/appointmentSlotLock.service.js";
import { isDoctorListRequest } from "../AppointmentModel/appointmentRoutingGuard.service.js";
import {
  APPOINTMENT_OPERATION_ROUTES,
  BOOKING_TO_MANAGE_SWITCH_REPLY_IDS,
  canonicalizeManageOperationMessage,
  getAppointmentOperationRouterMode,
  isAppointmentOperationDecisionEnabled,
  isManageSwitchRequestFromBookingReplyId,
  logAppointmentOperationRouterDecision,
  normalizeAppointmentOperationInput,
  routeAppointmentOperation,
} from "../AppointmentModel/appointmentOperationRouter.service.js";
import {
  buildBookingToManageSwitchConfirmPayload,
  sendAppointmentPayload,
} from "../AppointmentModel/whatsappAppointmentTemplates.service.js";
import {
  parseButtonReply,
  sendQuickReply,
  sendListMessage,
  sendAppointmentCard,
} from "./whatsappButtons.service.js"; // NEW

import { processBillingFromWebhook } from "../BillingModel/billing.service.js";
import {
  canUseAI,
  getSuspensionMessage,
  WALLET_STATUS,
} from "../../utils/billing/walletGuard.js";

import { getTenantByPhoneNumberIdService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import {
  applyMetaDeliveryToLimitEvent,
  metaTimestampToDate,
} from "../../services/metaMessagingLimit.service.js";
import {
  isPersistableMetaTier,
  normalizeMetaTierWebhookValue,
} from "../../utils/metaMessagingTier.js";
import { classifyMetaError } from "../../utils/metaErrorClassifier.js";
import { handleAsyncMetaFailure } from "../WhatsappCampaignModel/campaignPauseControl.service.js";
import { getIO } from "../../middlewares/socket/socket.js";
import {
  findTenantByIdService,
  getTenantSettingsService,
  updateTenantWebhookStatusService,
} from "../TenantModel/tenant.service.js";

import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  createContactService,
  getContactByPhoneAndTenantIdService,
  getOrCreateContactService,
  updateContactService,
} from "../ContactsModel/contacts.service.js";
import { MISSING_INFO_FALLBACK_REPLY } from "../../utils/ai/prompts/system.js";
import {
  createLeadService,
  getLeadByContactIdService,
  getLeadSummaryService,
  updateLeadService,
  updateLeadStatusService,
} from "../LeadsModel/leads.service.js";
import {
  createLiveChatService,
  getLivechatByIdService,
  updateLiveChatTimestampService,
} from "../LiveChatModel/livechat.service.js";
import { markMediaAsApprovedService } from "../GalleryModel/gallery.service.js";
import {
  processInboundRepeatedMessage,
  shouldDiscardAutomatedReply,
} from "../../services/repeatedMessageGuard.service.js";
import { dispatchHandoffForPause } from "../../services/aiHandoffOutbox.service.js";

const FIXED_MISSING_INFO_FALLBACK = MISSING_INFO_FALLBACK_REPLY;

// Trace helper — mirrors the one in the service file
const faqTrace = (label, data) => {
  const line = `[${new Date().toISOString()}] ${label} ${JSON.stringify(data)}\n`;
  process.stdout.write(line);
  try {
    fs.appendFileSync("/tmp/faq_trace.log", line);
  } catch {}
};

const ENABLE_APPOINTMENT_BUTTONS = false;

const ADVANCED_BOOKING_REPLY_IDS = new Set([
  "create_appointment",
  "confirm_booking",
  "edit_details",
  "continue_appointment",
  "edit_name",
  "edit_email",
  "edit_doctor",
  "edit_date",
  "edit_time",
  "edit_reason",
  "back_confirm",
]);

const ADVANCED_BOOKING_REPLY_PREFIXES = [
  "doctor_",
  "date_",
  "SLOT_",
  "slot_",
  "reason_",
];

const isAdvancedBookingReplyId = (replyId = "") => {
  const id = String(replyId || "").trim();
  return (
    ADVANCED_BOOKING_REPLY_IDS.has(id) ||
    ADVANCED_BOOKING_REPLY_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
};

const isDoctorListTemplateRequest = ({ text = "", replyId = null } = {}) => {
  const visibleText = String(text || "").trim();
  if (!visibleText) return false;
  if (replyId && isAdvancedBookingReplyId(replyId)) return false;
  return isDoctorListRequest(visibleText);
};

const isLegacyAppointmentManagementReplyId = (replyId = "") => {
  const id = String(replyId || "").trim();
  if (!id) return false;
  if (id === "view_my_appointments" || id === "cancel_appointment") return true;
  if (id.startsWith("reschedule_")) return true;
  return id.startsWith("cancel_") && id !== "cancel_booking";
};

const getLegacyAppointmentIntentForReply = (replyId = "") => {
  const id = String(replyId || "").trim();
  if (id === "view_my_appointments") return "view_my_appointments";
  if (id === "cancel_appointment" || id.startsWith("cancel_"))
    return "cancel_appointment";
  if (id.startsWith("reschedule_")) return "reschedule_appointment";
  return null;
};

const MISSING_INFO_TAGS = new Set([
  "MISSING_KNOWLEDGE",
  "MISSING_KNOWLEDGEBASE_HOOK",
  "MISSING_INFO",
]);

const MISSING_INFO_REPLY_PATTERN =
  /(i\s*do\s*not|i\s*don't|i\s*cannot|i\s*can't|i\s+do\s+not\s+have\s+that\s+detail\s+right\s+now|unable\s+to|not\s+enough\s+information|outside\s+(my|our)\s+(scope|knowledge)|our team will get back to you shortly|let me check with the team)/i;

const normalizeRequestedTopic = (text = "") =>
  String(text || "")
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 120) || "your question";

const resolveAiReplyEnvelope = (aiResult, userText) => {
  const finalReply = aiResult?.message;
  const requestedTopic = normalizeRequestedTopic(userText);

  const detectedTag = aiResult?.tagDetected || null;
  const isMissingInfoTag = detectedTag
    ? MISSING_INFO_TAGS.has(detectedTag)
    : false;
  const looksLikeMissingInfoReply = MISSING_INFO_REPLY_PATTERN.test(
    finalReply || "",
  );
  const isMissingInfoSignal = isMissingInfoTag || looksLikeMissingInfoReply;

  const tagToExecute =
    detectedTag || (isMissingInfoSignal ? "MISSING_KNOWLEDGEBASE_HOOK" : null);
  const tagPayloadToExecute =
    aiResult?.tagPayload || (isMissingInfoSignal ? requestedTopic : null);

  const fallback = isMissingInfoSignal
    ? FIXED_MISSING_INFO_FALLBACK
    : aiResult?.tagDetected
      ? ""
      : "I don't have a confirmed answer for that right now. Please feel free to ask another question.";

  // When MISSING_KNOWLEDGE is detected but the AI DID provide a real answer,
  // send the AI's actual reply (not the fallback). Only use the fallback
  // when the AI reply is empty/null (true missing info scenario).
  const messageToSend =
    finalReply && finalReply.trim() ? finalReply.trim() : fallback;

  return {
    messageToSend,
    tagToExecute,
    tagPayloadToExecute,
    isMissingInfoSignal,
  };
};

export const verifyWebhook = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token && tenantId) {
      // Find tenant strictly from DB - NO env fallback
      const tenant = await findTenantByIdService(tenantId);
      const expectedToken = tenant?.verify_token;

      if (expectedToken && token === expectedToken) {
        // Mark webhook as verified in the database
        await updateTenantWebhookStatusService(tenantId, true);
        return res.status(200).send(challenge);
      }
    }

    // No more fallback to META_VERIFY_TOKEN in env
    return res.sendStatus(403);
  } catch (err) {
    console.error("Verify Webhook error:", err);
    return res.sendStatus(500);
  }
};

export const receiveMessage = async (req, res) => {
  const io = getIO();
  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const value = change?.value;
    const field = change?.field;
    const msg = value?.messages?.[0];
    const statusUpdate = value?.statuses?.[0];

    // FIX 5 — both webhooks carry a messaging-capability / tier change.
    // `phone_number_quality_update` also carries quality_rating.
    if (
      field === "phone_number_quality_update" ||
      field === "business_capability_update"
    ) {
      const wabaId = req.body?.entry?.[0]?.id;
      const phoneNumberId = value?.phone_number_id || value?.metadata?.phone_number_id;
      const rawTier =
        value?.max_daily_conversations_per_business ??
        value?.maxDailyConversationsPerBusiness ??
        value?.max_daily_conversation_per_phone_numbers ??
        value?.messaging_limit ??
        value?.current_limit ??
        null;
      const tier = normalizeMetaTierWebhookValue(rawTier);
      const quality = String(value?.quality_rating || value?.quality || "").toUpperCase();
      const update = { meta_info_synced_at: new Date() };

      // Preservation rule: only overwrite the cached tier with a recognised
      // value. A missing / null / garbage payload leaves the last-known tier.
      if (isPersistableMetaTier(tier)) update.tier = tier;
      if (["GREEN", "YELLOW", "RED", "UNKNOWN"].includes(quality)) {
        update.quality = quality;
      }

      if ((wabaId || phoneNumberId) && (update.tier || update.quality)) {
        await db.Whatsappaccount.update(update, {
          where: {
            ...(wabaId ? { waba_id: wabaId } : {}),
            ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
            is_deleted: false,
          },
        });
      } else if (wabaId || phoneNumberId) {
        // nothing usable in the payload — still bump the sync marker so
        // reconciliation knows Meta pinged us.
        await db.Whatsappaccount.update(
          { meta_info_synced_at: new Date() },
          {
            where: {
              ...(wabaId ? { waba_id: wabaId } : {}),
              ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
              is_deleted: false,
            },
          },
        );
      }
      return res.sendStatus(200);
    }

    // 0. Handle Template Status Updates (Meta approval/rejection)
    if (field === "message_template_status_update") {
      const templateName = value.message_template_name;
      const templateId = String(value.message_template_id);
      const status = value.event; // e.g., "APPROVED", "REJECTED"
      const rejectionReason = value.reason || null; // Only present on REJECTED events
      const wabaId = req.body?.entry?.[0]?.id;

      console.log(
        `[WEBHOOK] Template Status Update: ${templateName} (${status}) for WABA ${wabaId}`,
      );

      // Map Meta status to our local status
      const STATUS_MAP = {
        APPROVED: "approved",
        REJECTED: "rejected",
        PENDING: "pending",
        PAUSED: "paused",
        DISABLED: "disabled",
      };

      const mappedStatus = STATUS_MAP[status] || "pending";

      try {
        const [[account]] = await db.sequelize.query(
          `
          SELECT tenant_id
          FROM ${tableNames.WHATSAPP_ACCOUNT}
          WHERE waba_id = ?
            AND is_deleted = false
          LIMIT 1
          `,
          { replacements: [wabaId] },
        );

        if (!account?.tenant_id) {
          console.warn(
            `[WEBHOOK] No tenant found for template status update WABA ${wabaId}`,
          );
          return res.sendStatus(200);
        }

        // Update template status in DB
        const [[template]] = await db.sequelize.query(
          `
          SELECT
            t.template_id,
            COALESCE(
              t.media_asset_id,
              (SELECT c2.media_asset_id
               FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} c2
               WHERE c2.template_id = t.template_id
                 AND c2.component_type = 'header'
                 AND c2.media_asset_id IS NOT NULL
               LIMIT 1)
            ) AS media_asset_id
          FROM ${tableNames.WHATSAPP_TEMPLATE} t
          WHERE t.tenant_id = ?
            AND t.is_deleted = false
            AND (t.meta_template_id = ? OR t.template_name = ?)
          LIMIT 1
          `,
          { replacements: [account.tenant_id, templateId, templateName] },
        );

        if (template) {
          await db.sequelize.query(
            `
            UPDATE ${tableNames.WHATSAPP_TEMPLATE}
            SET status = ?, rejection_reason = ?
            WHERE template_id = ?
              AND tenant_id = ?
            `,
            {
              replacements: [
                mappedStatus,
                mappedStatus === "rejected" ? rejectionReason : null,
                template.template_id,
                account.tenant_id,
              ],
            },
          );

          await db.sequelize.query(
            `
            INSERT INTO ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS}
            (template_id, action, response_payload, meta_status)
            VALUES (?, 'webhook', ?, ?)
            `,
            {
              replacements: [
                template.template_id,
                JSON.stringify({
                  event: status,
                  reason: rejectionReason || null,
                }),
                mappedStatus,
              ],
            },
          );

          // If approved and has media, mark media as approved
          if (status === "APPROVED" && template.media_asset_id) {
            await markMediaAsApprovedService(template.media_asset_id);
            console.log(
              `[WEBHOOK] Gallery Asset ${template.media_asset_id} auto-approved via template ${templateName}`,
            );
          }
        }
      } catch (err) {
        console.error(
          "[WEBHOOK] Error processing template status update:",
          err,
        );
      }

      return res.sendStatus(200);
    }

    // 1. Handle Status Updates (Sent/Delivered/Read)
    if (statusUpdate) {
      const messageId = statusUpdate.id;
      const status = statusUpdate.status;
      let campaignUpdatePayload = null;

      // Normally Meta webhook statuses don't always give tenantId directly, we find it from wamid
      let webhook_tenant_id = null;
      try {
        const [msgSearch] = await db.sequelize.query(
          `SELECT tenant_id FROM messages WHERE wamid = ? LIMIT 1`,
          { replacements: [messageId] },
        );
        if (msgSearch.length > 0) {
          webhook_tenant_id = msgSearch[0].tenant_id;
        } else {
          // Fallback 1: Check if this was a Campaign Message broadcast
          const [campaignSearch] = await db.sequelize.query(
            `SELECT c.tenant_id FROM whatsapp_campaign_recipients r 
             JOIN whatsapp_campaigns c ON r.campaign_id = c.campaign_id 
             WHERE r.meta_message_id = ? LIMIT 1`,
            { replacements: [messageId] },
          );
          if (campaignSearch.length > 0) {
            webhook_tenant_id = campaignSearch[0].tenant_id;
          } else {
            // Fallback 2: Direct lookup from phone_number_id (covers Postman/Direct API calls)
            const phoneId = value?.metadata?.phone_number_id;
            if (phoneId) {
              const [accountSearch] = await db.sequelize.query(
                `SELECT tenant_id FROM whatsapp_accounts WHERE phone_number_id = ? LIMIT 1`,
                { replacements: [phoneId] },
              );
              if (accountSearch.length > 0) {
                webhook_tenant_id = accountSearch[0].tenant_id;
              }
            }
          }
        }

        // Fallback 3: Direct lookup from WABA ID (Very reliable for Meta UI messages)
        if (!webhook_tenant_id) {
          const wabaId = req.body?.entry?.[0]?.id;
          if (wabaId) {
            const [wabaSearch] = await db.sequelize.query(
              `SELECT tenant_id FROM whatsapp_accounts WHERE waba_id = ? LIMIT 1`,
              { replacements: [wabaId] },
            );
            if (wabaSearch.length > 0) {
              webhook_tenant_id = wabaSearch[0].tenant_id;
            }
          }
        }
      } catch (e) {
        console.error("Error finding tenant_id for webhook:", e);
      }

      // B-4: Cross-validate webhook phone_number_id belongs to resolved tenant (security fix)
      if (webhook_tenant_id && value?.metadata?.phone_number_id) {
        try {
          const webhookPhoneId = value.metadata.phone_number_id;
          const [tenantPhoneAccount] = await db.sequelize.query(
            `SELECT phone_number_id FROM whatsapp_accounts 
             WHERE tenant_id = ? AND phone_number_id = ? LIMIT 1`,
            { replacements: [webhook_tenant_id, webhookPhoneId] },
          );

          if (!tenantPhoneAccount || tenantPhoneAccount.length === 0) {
            // B-4: Tenant-scoping mismatch — webhook phone_number_id does not belong to resolved tenant
            console.error(
              `[WEBHOOK] SECURITY: Tenant-scoping mismatch for status update ${messageId}. ` +
                `Resolved tenant=${webhook_tenant_id} but webhook phone_number_id=${webhookPhoneId} ` +
                `does not belong to that tenant. Rejecting webhook.`,
            );
            return res.sendStatus(200); // Accept HTTP but reject processing
          }
        } catch (e) {
          console.error(
            `[WEBHOOK] Error validating tenant-scoping for message ${messageId}:`,
            e,
          );
          // On error, continue processing (fail-open for availability, but log the issue)
        }
      }

      if (webhook_tenant_id) {
        console.log(
          `[WEBHOOK] Identified tenant ${webhook_tenant_id} for status update: ${messageId}`,
        );
        // Fire and forget billing cost calculation
        setImmediate(() => {
          processBillingFromWebhook(webhook_tenant_id, statusUpdate);
        });
      } else {
        console.warn(
          `[WEBHOOK] Could not identify tenant for status update: ${messageId}. Payload:`,
          JSON.stringify(value?.metadata),
        );
      }

      // FIX 9 — prefer Meta's own webhook timestamp (Unix seconds) for delivered_at.
      // R-3 — if the ledger row isn't correlated yet, the call durably records
      // the event for a bounded retry (pass the payload for that retry).
      const metaEventAt = metaTimestampToDate(statusUpdate.timestamp);
      try {
        await applyMetaDeliveryToLimitEvent(messageId, status, metaEventAt, {
          payload: statusUpdate,
        });
      } catch (limitError) {
        console.error(
          `[META-LIMIT] Delivery ledger update failed for ${messageId}:`,
          limitError.message,
        );
      }

      // FIX 8 — a `failed` status webhook can carry a Meta error that only shows
      // up asynchronously (POST succeeded, delivery failed later). Route it
      // through the SAME classifier + pause control the sync worker uses.
      if (status === "failed" && Array.isArray(statusUpdate.errors) && statusUpdate.errors.length) {
        try {
          let asyncCampaignId = campaignUpdatePayload?.campaign_id || null;
          if (!asyncCampaignId) {
            const [recRow] = await db.sequelize.query(
              `SELECT campaign_id FROM whatsapp_campaign_recipients WHERE meta_message_id = ? LIMIT 1`,
              { replacements: [messageId] },
            );
            asyncCampaignId = recRow?.[0]?.campaign_id || null;
          }
          if (webhook_tenant_id) {
            await handleAsyncMetaFailure({
              tenantId: webhook_tenant_id,
              campaignId: asyncCampaignId,
              metaErrors: statusUpdate.errors.map((e) => ({
                code: e?.code ?? e?.error_code,
                title: e?.title,
                message: e?.message,
                details: e?.error_data?.details || e?.details,
                error_subcode: e?.error_subcode,
                error_data: e?.error_data,
              })),
            });
          }
        } catch (asyncErr) {
          console.error(
            `[META-LIMIT] Async failed-webhook handling error for ${messageId}:`,
            asyncErr.message,
          );
        }
      }

      await db.sequelize.transaction(async (t) => {
        const recipient = await db.WhatsappCampaignRecipients.findOne({
          where: { meta_message_id: messageId },
          include: [{ model: db.WhatsappCampaigns, as: "campaign" }],
          lock: t.LOCK.UPDATE,
          transaction: t,
        });

        if (recipient) {
          const oldStatus = recipient.status;
          if (
            status === "failed" &&
            ["delivered", "read", "replied"].includes(oldStatus)
          ) {
            return;
          }
          const statusPriority = {
            sent: 1,
            delivered: 2,
            read: 3,
            replied: 4,
            failed: 5,
            permanently_failed: 6,
          };

          // Any 'failed' delivery webhook from Meta is terminal — Meta does
          // not retry a failed send on our behalf, and no internal worker re-
          // dispatches recipients in status='failed' either. Collapse to
          // 'permanently_failed' so recipient state matches the send worker's
          // permanent-failure path and campaigns can finalize cleanly.
          const effectiveStatus =
            status === "failed" ? "permanently_failed" : status;

          if (
            statusPriority[effectiveStatus] > (statusPriority[oldStatus] || 0)
          ) {
            const errorTitle = statusUpdate.errors?.[0]?.title || null;
            const errorMessage = statusUpdate.errors?.[0]?.message || null;
            const combinedError =
              [errorTitle, errorMessage].filter(Boolean).join(": ") || null;
            const updateData = {
              status: effectiveStatus,
              error_message:
                effectiveStatus === "permanently_failed" ? combinedError : null,
            };

            if (effectiveStatus === "permanently_failed") {
              updateData.last_error = combinedError;
              updateData.retry_count = 3;
              updateData.next_retry_at = null;
            }

            await recipient.update(updateData, { transaction: t });

            if (recipient.campaign) {
              if (status === "delivered" && oldStatus === "sent") {
                await recipient.campaign.increment("delivered_count", {
                  transaction: t,
                });
              } else if (status === "read") {
                if (oldStatus === "sent") {
                  await recipient.campaign.increment(
                    ["delivered_count", "read_count"],
                    { transaction: t },
                  );
                } else if (oldStatus === "delivered") {
                  await recipient.campaign.increment("read_count", {
                    transaction: t,
                  });
                }
              }
              campaignUpdatePayload = {
                campaign_id: recipient.campaign_id,
                tenant_id: recipient.campaign.tenant_id,
                status: effectiveStatus,
              };
            }
          }
        }
      });

      // After webhook status update, check if campaign should be marked completed/failed
      // B-3: Only finalize if last_dispatch_enqueued_at is >5 minutes old to prevent race
      if (
        campaignUpdatePayload &&
        campaignUpdatePayload.status === "permanently_failed"
      ) {
        setImmediate(async () => {
          try {
            const campaign_id = campaignUpdatePayload.campaign_id;

            // Count remaining pending recipients
            const pendingCount = await db.WhatsappCampaignRecipients.count({
              where: { campaign_id, status: "pending", is_deleted: false },
            });

            // If no pending recipients, finalize the campaign. BullMQ retries
            // happen entirely in-memory before a recipient transitions out of
            // "pending", so once pendingCount === 0 every retry has already
            // resolved. No re-dispatch path exists for status='failed' or
            // 'permanently_failed' recipients, so they are terminal here.
            if (pendingCount === 0) {
              const successCount = await db.WhatsappCampaignRecipients.count({
                where: {
                  campaign_id,
                  is_deleted: false,
                  status: {
                    [db.Sequelize.Op.in]: [
                      "sent",
                      "delivered",
                      "read",
                      "replied",
                    ],
                  },
                },
              });

              // B-3: Only update if last_dispatch_enqueued_at is >5 minutes old
              // This prevents marking campaign complete while a fresh dispatch is still enqueued
              const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
              const newStatus = successCount > 0 ? "completed" : "failed";
              const [affectedRows] = await db.sequelize.query(
                `UPDATE ${tableNames.WHATSAPP_CAMPAIGN}
                 SET status = ?
                 WHERE campaign_id = ?
                   AND status = 'active'
                   AND (last_dispatch_enqueued_at IS NULL OR last_dispatch_enqueued_at < ?)`,
                { replacements: [newStatus, campaign_id, fiveMinutesAgo] },
              );

              if (affectedRows > 0) {
                console.log(
                  `[WEBHOOK] Campaign ${campaign_id} marked as ${newStatus} — success=${successCount}`,
                );
              }
            }
          } catch (err) {
            console.error(
              "[WEBHOOK] Campaign status update error:",
              err.message,
            );
          }
        });
      }

      if (campaignUpdatePayload) {
        try {
          const io = getIO();
          io.to(`tenant-${campaignUpdatePayload.tenant_id}`).emit(
            "campaign-status-update",
            campaignUpdatePayload,
          );
        } catch (socketErr) {
          console.error(
            "[SOCKET] Campaign status emit failed:",
            socketErr.message,
          );
        }
      }

      // Also update the regular messages table status using wamid
      try {
        const allowedMsgStatuses = ["sent", "delivered", "read", "failed"];
        if (allowedMsgStatuses.includes(status)) {
          const [msgRows] = await db.sequelize.query(
            `SELECT id, tenant_id, contact_id, phone, status FROM messages WHERE wamid = ? LIMIT 1`,
            { replacements: [messageId] },
          );
          if (msgRows.length > 0) {
            const msgRow = msgRows[0];
            const statusPriority = {
              sent: 1,
              delivered: 2,
              read: 3,
              failed: 0,
            };
            const currentPriority = statusPriority[msgRow.status] ?? -1;

            // For failed status, always update if current status is "sent" (message never delivered)
            // For other statuses, use priority system
            const shouldUpdate =
              (status === "failed" && msgRow.status === "sent") ||
              (status !== "failed" && statusPriority[status] > currentPriority);

            if (shouldUpdate) {
              await db.sequelize.query(
                `UPDATE messages SET status = ? WHERE id = ?`,
                { replacements: [status, msgRow.id] },
              );
              console.log(
                `[WEBHOOK] Updated message ${msgRow.id} status to ${status}`,
              );
              try {
                io.to(`tenant-${msgRow.tenant_id}`).emit(
                  "message-status-update",
                  {
                    message_id: msgRow.id,
                    phone: msgRow.phone,
                    contact_id: msgRow.contact_id,
                    status,
                  },
                );
              } catch (socketErr) {
                console.error(
                  "[SOCKET] Message status emit failed:",
                  socketErr.message,
                );
              }
            }
          }
        }
      } catch (statusErr) {
        console.error(
          "[WEBHOOK] Error updating message status:",
          statusErr.message,
        );
      }

      return res.sendStatus(200);
    }

    // 2. Validate Incoming Message
    if (!msg) return res.sendStatus(200);

    const phone_number_id = value?.metadata?.phone_number_id;
    if (!phone_number_id) return res.sendStatus(200);

    const account = await getTenantByPhoneNumberIdService(phone_number_id);
    if (!account) return res.sendStatus(200);

    const tenant_id = account.tenant_id;
    const { tenantId: urlTenantId } = req.params;

    if (urlTenantId && urlTenantId !== tenant_id) {
      return res.sendStatus(200);
    }

    // 3. Format Phone and Text
    let phone = formatPhoneNumber(msg.from);
    const messageId = msg.id;
    const name = value?.contacts?.[0]?.profile?.name || null;
    let text = "";
    const type = msg.type;

    let media_url = null;
    let media_mime_type = null;
    let media_filename = null;

    if (type === "text") text = msg.text?.body || "";
    else if (type === "interactive") {
      const interactive = msg.interactive;
      if (interactive.type === "button_reply")
        text = interactive.button_reply.title;
      else if (interactive.type === "list_reply")
        text = interactive.list_reply.title;
      else text = "[Interactive Message]";
    } else if (type === "button") text = msg.button?.text || "[Button Click]";
    else if (type === "image") {
      text = msg.image?.caption || "";
      media_url = msg.image?.id ? `meta_media_id:${msg.image.id}` : null;
      media_mime_type = msg.image?.mime_type || "image/jpeg";
    } else if (type === "video") {
      text = msg.video?.caption || "";
      media_url = msg.video?.id ? `meta_media_id:${msg.video.id}` : null;
      media_mime_type = msg.video?.mime_type || "video/mp4";
    } else if (type === "document") {
      text = msg.document?.caption || msg.document?.filename || "";
      media_url = msg.document?.id ? `meta_media_id:${msg.document.id}` : null;
      media_mime_type = msg.document?.mime_type || "application/octet-stream";
      media_filename = msg.document?.filename || null;
    } else if (type === "audio") {
      text = "";
      media_url = msg.audio?.id ? `meta_media_id:${msg.audio.id}` : null;
      media_mime_type = msg.audio?.mime_type || "audio/ogg";
    } else if (type === "location")
      text = `[Location: ${msg.location?.name || "Shared Location"}]`;
    else if (type === "contacts") text = "[Contact Card]";
    else text = "[Unknown Message Type]";

    // NEW: Extract button reply ID for appointment routing (separate from display text)
    const buttonReplyId = type === "interactive" ? parseButtonReply(msg) : null;
    const normalizedMessage = normalizeAppointmentOperationInput({
      messageText: text,
      buttonReplyId,
      messageType: type,
      rawPayload: msg,
    });

    // Diagnostic: log every webhook receipt to detect multi-instance delivery
    console.log("[WEBHOOK-RECV]", {
      pid: process.pid,
      host: os.hostname(),
      messageId,
      phone,
      tenant_id,
    });

    // 4. Atomic dedupe gate. If this did not insert, Meta already delivered it.
    const didMarkMessage = await tryMarkMessageProcessed(
      tenant_id,
      phone_number_id,
      messageId,
      phone,
    );
    if (!didMarkMessage) {
      console.log("[WEBHOOK] Duplicate inbound message ignored:", {
        tenant_id,
        phone_number_id,
        messageId,
        phone,
      });
      return res.sendStatus(200);
    }

    // 5. Manage Contact and LiveChat
    // Use WhatsApp profile name directly
    const finalName = name || null;

    // Use atomic getOrCreate to prevent duplicate contacts from race conditions
    const {
      contact: contactsaved,
      created: isNewContact,
      restored,
    } = await getOrCreateContactService(tenant_id, phone, finalName, null);

    if (isNewContact) {
      io.to(`tenant-${tenant_id}`).emit("contact-created", {
        tenant_id,
        phone,
        name: finalName,
        contact_id: contactsaved?.contact_id,
      });
    } else if (restored) {
      console.log(
        `[WEBHOOK] Contact ${contactsaved?.contact_id} auto-restored`,
      );
    } else {
      // Update name if needed for existing contact
      if (finalName && (!contactsaved.name || contactsaved.name === phone)) {
        await updateContactService(
          contactsaved.contact_id,
          tenant_id,
          finalName,
          contactsaved.email,
          contactsaved.profile_pic,
          contactsaved.is_blocked,
        );
        contactsaved.name = finalName;
      }
    }

    const livelist = await getLivechatByIdService(
      tenant_id,
      contactsaved?.contact_id,
    );
    if (!livelist) {
      await createLiveChatService(tenant_id, contactsaved?.contact_id);
    } else {
      await updateLiveChatTimestampService(tenant_id, contactsaved?.contact_id);
    }

    // 6. Store User Message
    const savedMsg = await createUserMessageService(
      tenant_id,
      contactsaved?.contact_id,
      phone_number_id,
      phone,
      messageId,
      name,
      "user",
      null,
      text,
      type,
      media_url,
      media_mime_type,
      null, // status is for outbound delivery tracking, null for incoming messages
      null,
      media_filename,
    );

    const ioInstance = getIO();
    ioInstance.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone,
      id: savedMsg?.id,
      contact_id: contactsaved?.contact_id,
      phone_number_id,
      name: contactsaved?.name || name,
      message: text,
      sender: "user",
      message_type: type,
      media_url,
      media_mime_type,
      media_filename,
      status: "received",
      created_at: new Date(),
    });

    // Download-on-receive: immediately download Meta media to R2 so it never expires.
    // Meta media IDs are only valid for ~5 minutes after delivery.
    // We save the meta_media_id to DB first (fast, no user delay), then async-download
    // and update the DB + re-emit so the frontend swaps to the permanent R2 URL.
    const DOWNLOADABLE_TYPES = ["image", "video", "audio", "document"];
    if (
      DOWNLOADABLE_TYPES.includes(type) &&
      media_url?.startsWith("meta_media_id:")
    ) {
      const rawMediaId = media_url.replace("meta_media_id:", "");
      const msgId = savedMsg?.id;
      const capturedContactId = contactsaved?.contact_id;
      const capturedTenantId = tenant_id;

      setImmediate(async () => {
        try {
          const result = await downloadAndStoreIncomingMedia(
            rawMediaId,
            media_mime_type,
            type,
            capturedTenantId,
            capturedContactId,
          );
          if (!result?.r2Url) return;

          // Update the DB row with the permanent R2 URL
          await db.sequelize.query(
            `UPDATE messages SET media_url = ? WHERE id = ?`,
            { replacements: [result.r2Url, msgId] },
          );

          // Re-emit with the permanent URL so the frontend swaps immediately
          ioInstance
            .to(`tenant-${capturedTenantId}`)
            .emit("media-url-updated", {
              messageId: msgId,
              media_url: result.r2Url,
            });

          console.log(
            `[MEDIA-DOWNLOAD] Stored incoming ${type} → ${result.r2Url}`,
          );
        } catch (err) {
          console.error("[MEDIA-DOWNLOAD] Async download failed:", err.message);
        }
      });
    }

    // 8. Campaign Reply Tracking
    const cleanPhone = phone.replace(/\D/g, "");
    const phoneSuffix = cleanPhone.slice(-10);

    // Find the latest campaign message sent to this user
    const lastCampaignRecipient = await db.WhatsappCampaignRecipients.findOne({
      where: {
        mobile_number: { [db.Sequelize.Op.like]: `%${phoneSuffix}` },
        // Optimization: We only care about campaigns that aren't already marked as replied
        status: { [db.Sequelize.Op.ne]: "replied" },
      },
      order: [["created_at", "DESC"]],
      include: [
        {
          model: db.WhatsappCampaigns,
          as: "campaign",
          where: { tenant_id, is_deleted: false },
          required: true,
        },
      ],
    });

    if (lastCampaignRecipient) {
      const allowedStatuses = ["sent", "delivered", "read"];

      // Check if the message is in a valid state to receive a reply
      if (allowedStatuses.includes(lastCampaignRecipient.status)) {
        const campaignSentAt = new Date(
          lastCampaignRecipient.updated_at,
        ).getTime();
        const nowTime = new Date().getTime();
        const hoursDiff = (nowTime - campaignSentAt) / (1000 * 60 * 60);

        // Logic: If user messages within 24 hours of a campaign, count it as a reply
        if (hoursDiff <= 24) {
          // Use a transaction to prevent race conditions (double counting)
          await db.sequelize.transaction(async (t) => {
            const recipientToUpdate =
              await db.WhatsappCampaignRecipients.findByPk(
                lastCampaignRecipient.id,
                {
                  include: [{ model: db.WhatsappCampaigns, as: "campaign" }],
                  lock: t.LOCK.UPDATE,
                  transaction: t,
                },
              );

            // Double-check status inside the lock
            if (recipientToUpdate && recipientToUpdate.status !== "replied") {
              await recipientToUpdate.update(
                { status: "replied" },
                { transaction: t },
              );

              if (recipientToUpdate.campaign) {
                await recipientToUpdate.campaign.increment("replied_count", {
                  transaction: t,
                });
              }
            }
          });
        }
      }
    }

    // 9. Lead Source Attribution
    let lead_source = "none";
    if (msg.referral) {
      const referral = msg.referral;
      if (referral.source_type === "ad") {
        lead_source = referral.source_url?.includes("facebook.com")
          ? "facebook"
          : referral.source_url?.includes("instagram.com")
            ? "instagram"
            : "meta";
      } else if (referral.source_type === "post") {
        lead_source = "post";
      }
    }

    let leadSaved = await getLeadByContactIdService(
      tenant_id,
      contactsaved?.contact_id,
    );
    if (!leadSaved) {
      await createLeadService(tenant_id, contactsaved?.contact_id, lead_source);
      leadSaved = await getLeadByContactIdService(
        tenant_id,
        contactsaved?.contact_id,
      );
    } else if (
      msg.referral &&
      ["whatsapp", "none"].includes(leadSaved.source)
    ) {
      await updateLeadStatusService(
        tenant_id,
        leadSaved.lead_id,
        null,
        null,
        null,
        null,
        null,
        lead_source,
      );
    }
    await updateLeadService(tenant_id, leadSaved?.contact_id, {
      sourceEvent: "user_message",
      message_id: savedMsg?.id,
      message_text: text,
      skipIntentAi: true,
    });
    io.to(`tenant-${tenant_id}`).emit("lead-updated", {
      tenant_id,
      contact_id: contactsaved?.contact_id,
    });

    // 9.5 Repeated User Message → AI Handoff guard (feature-flag gated; no-op
    // when disabled). Runs on the accepted, de-duplicated inbound message
    // AFTER persistence and BEFORE the long AI lock / pending queue.
    let repeatGuard = {
      enabled: false,
      paused: false,
      justPaused: false,
      epoch: 0,
    };
    try {
      repeatGuard = await processInboundRepeatedMessage({
        tenant_id,
        contact_id: contactsaved?.contact_id,
        messageType: type,
        text,
        triggerMessageId: messageId || null,
      });
    } catch (guardErr) {
      console.error(
        "[REPEAT-GUARD] processInboundRepeatedMessage failed:",
        guardErr.message,
      );
    }
    console.log(
      `[REPEAT-GUARD] result for ${phone} type=${type}:`,
      JSON.stringify(repeatGuard),
    );
    const aiReplyStartEpoch = repeatGuard.epoch;

    if (repeatGuard.enabled && repeatGuard.paused) {
      if (repeatGuard.justPaused) {
        try {
          io.to(`tenant-${tenant_id}`).emit("contact-ai-state-updated", {
            contactId: contactsaved?.contact_id,
            isAiSilenced: true,
            pauseReason: "repeated_user_message",
            pausedAt: new Date(),
            aiReplyEpoch: repeatGuard.epoch,
          });
        } catch (emitErr) {
          console.error("[REPEAT-GUARD] state emit failed:", emitErr.message);
        }
        setImmediate(() =>
          dispatchHandoffForPause(
            tenant_id,
            contactsaved?.contact_id,
            repeatGuard.epoch,
          ).catch((e) =>
            console.error("[HANDOFF-OUTBOX] dispatch failed:", e.message),
          ),
        );
      }
      // Mark the customer's message read (blue tick) so they can see it landed
      // and a human will follow up — the AI read-receipt path is skipped below.
      if (messageId) {
        sendReadReceipt(tenant_id, phone_number_id, messageId).catch(() => {});
      }
      // Durable pause — skip ALL reactive AI automation. The inbound message is
      // already persisted and displayed. Elapsed time, different messages and
      // further repeats never auto-resume AI; only an explicit staff Resume does.
      return res.sendStatus(200);
    }

    // 10. AI Processing (Background) — Atomic lock + message queue
    const lockAcquired = await tryAcquireLock(
      tenant_id,
      phone_number_id,
      phone,
    );
    if (!lockAcquired) {
      // Another message is being processed — queue this one so it's handled after
      queuePendingMessage(tenant_id, phone, {
        text,
        buttonReplyId,
        normalizedMessage,
        type,
        contact_id: contactsaved?.contact_id,
        phone_number_id,
        messageId,
        message_db_id: savedMsg?.id || null,
        name,
        contactsaved,
      });
      return res.sendStatus(200);
    }
    res.sendStatus(200); // Acknowledge Webhook

    setImmediate(async () => {
      try {
        const tenantSettings = await getTenantSettingsService(tenant_id);
        const autoResponderEnabled =
          tenantSettings?.ai_settings?.auto_responder !== false;

        if (!autoResponderEnabled) {
          console.log(
            `[WEBHOOK] AI Auto-Responder is globally disabled for tenant: ${tenant_id}`,
          );
          return;
        }

        if (contactsaved?.is_ai_silenced) {
          console.log(
            `[WEBHOOK] AI is silenced for specific contact: ${phone}`,
          );
          return;
        }

        // Fresh durable eligibility re-check (repeated-message handoff / epoch
        // fence). No-op when the feature flag is disabled.
        if (
          await shouldDiscardAutomatedReply(
            tenant_id,
            contactsaved?.contact_id,
            aiReplyStartEpoch,
          )
        ) {
          console.log(
            `[REPEAT-GUARD] Reactive AI skipped for ${phone} (paused or epoch changed)`,
          );
          return;
        }

        // Build cached data once — shared by text, vision, and appointment paths
        const cachedData = {
          tenantSettings,
          contact: contactsaved,
          lead: leadSaved,
        };

        // AI will respond — send read receipt (blue tick) and typing indicator
        sendReadReceipt(tenant_id, phone_number_id, messageId);
        sendTypingIndicator(tenant_id, phone_number_id, phone, messageId);

        // Build a contact object that appointment handlers expect.
        const contactObj = { ...contactsaved, phone_number: phone }; // NEW
        const currentNormalizedMessage = normalizedMessage;

        console.log(
          "[AI FLOW]",
          "Appointment buttons enabled:",
          ENABLE_APPOINTMENT_BUTTONS,
        );

        const activeManageAppointmentSession =
          await hasActiveManageAppointmentSession({
            tenantId: tenant_id,
            userPhone: phone,
          }).catch(() => false);
        if (
          !activeManageAppointmentSession &&
          isDoctorListTemplateRequest({ text, replyId: buttonReplyId })
        ) {
          await expireAdvancedAppointmentSessionIfNeeded({
            tenant_id,
            phone,
            contactObj,
            message: text,
            whatsappMessageId: messageId || null,
          });
          const doctorListResult =
            await buildAvailableDoctorListAppointmentResponse({
              tenantId: tenant_id,
              userPhone: phone,
            });
          await handleAdvancedAppointmentResponse(
            doctorListResult,
            tenant_id,
            phone,
            contactsaved,
            phone_number_id,
            name,
          );
          return;
        }

        // ── Vision: Image messages → GPT-4o reads the image + conversation history ──
        if (type === "image") {
          let imageUrl = media_url;

          // If download-on-receive hasn't finished yet, fetch inline — Meta URL is still
          // valid within the same webhook window (well under the ~5-min expiry).
          if (imageUrl?.startsWith("meta_media_id:")) {
            const rawId = imageUrl.replace("meta_media_id:", "");
            const dlResult = await downloadAndStoreIncomingMedia(
              rawId,
              media_mime_type,
              "image",
              tenant_id,
              contactsaved?.contact_id,
            ).catch(() => null);
            imageUrl = dlResult?.r2Url || null;
          }

          if (!imageUrl) {
            await sendWhatsAppMessage(
              tenant_id,
              phone,
              "I received your image but couldn't open it. Please try sending it again.",
            ).catch(() => {});
            return;
          }

          const visionResult = await getOpenAIVisionReply(
            tenant_id,
            phone,
            imageUrl,
            text,
            contactsaved?.contact_id,
            phone_number_id,
            cachedData,
          );

          const visionReply = visionResult?.message;
          if (!visionReply) return;

          if (
            await shouldDiscardAutomatedReply(
              tenant_id,
              contactsaved?.contact_id,
              aiReplyStartEpoch,
            )
          ) {
            console.log(
              `[REPEAT-GUARD] Discarding stale vision reply before send for ${phone}`,
            );
            getIO()
              .to(`tenant-${tenant_id}`)
              .emit("ai-typing", { tenant_id, phone, status: false });
            return;
          }

          let visionWamid = null;
          try {
            const visionSend = await sendWhatsAppMessage(
              tenant_id,
              phone,
              visionReply,
            );
            visionWamid = visionSend?.wamid || null;
          } catch (sendErr) {
            console.error("[VISION-AI] Failed to send reply:", sendErr.message);
          }

          const savedVisionMsg = await createUserMessageService(
            tenant_id,
            contactsaved?.contact_id,
            phone_number_id,
            phone,
            visionWamid,
            name,
            "bot",
            null,
            visionReply,
            "text",
            null,
            null,
            visionWamid ? "sent" : null,
          );

          const ioVision = getIO();
          ioVision
            .to(`tenant-${tenant_id}`)
            .emit("ai-typing", { tenant_id, phone, status: false });
          ioVision.to(`tenant-${tenant_id}`).emit("new-message", {
            tenant_id,
            phone,
            id: savedVisionMsg?.id,
            contact_id: contactsaved?.contact_id,
            phone_number_id,
            name: contactsaved?.name || name,
            message: visionReply,
            message_type: "text",
            media_url: null,
            sender: "bot",
            status: "sent",
            created_at: new Date(),
          });
          return;
        }

        // ── Audio / voice guard — send polite fallback (audio transcription is future work) ──
        if (type === "audio") {
          await sendWhatsAppMessage(
            tenant_id,
            phone,
            "I received your voice message! If you have a question, please type it and I'll be happy to help.",
          ).catch(() => {});
          return;
        }

        // ── Video / document — acknowledge receipt, invite text question ──
        if (type === "video" || type === "document") {
          await sendWhatsAppMessage(
            tenant_id,
            phone,
            "Thanks for sharing! If you have any questions, please type them and I'll be happy to help.",
          ).catch(() => {});
          return;
        }

        // Greetings and non-booking questions stay in normal AI/GENERAL_QUESTION routing.

        // Check wallet status before AI processing (pass small estimated cost for prepaid check)
        const walletCheck = await canUseAI(tenant_id, 0.5);
        if (!walletCheck.allowed) {
          console.log(
            `[WEBHOOK] Wallet blocked for tenant ${tenant_id}. Mode: ${walletCheck.billing_mode}, Balance: ₹${walletCheck.balance?.toFixed(2)}`,
          );
          // Send suspension fallback message to customer
          const suspensionMsg = await getSuspensionMessage(tenant_id);
          await sendWhatsAppMessage(tenant_id, phone, suspensionMsg).catch(
            (err) =>
              console.error(
                "[WEBHOOK] Failed to send suspension message:",
                err.message,
              ),
          );
          // Clear typing indicator
          const ioInst = getIO();
          ioInst.to(`tenant-${tenant_id}`).emit("ai-typing", {
            tenant_id,
            phone,
            status: false,
          });
          // Emit wallet warning to dashboard
          ioInst.to(`tenant-${tenant_id}`).emit("wallet-suspended", {
            tenant_id,
            balance: walletCheck.balance,
            billing_mode: walletCheck.billing_mode,
            message: walletCheck.reason,
          });
          return;
        }

        const {
          handled: handledByRouter,
          routingResult,
          routerMode,
        } = await routeAndMaybeHandleAppointmentOperation({
          tenant_id,
          phone,
          contact_id: contactsaved?.contact_id,
          normalizedMessage: currentNormalizedMessage,
          contactObj,
          contactsaved,
          phone_number_id,
          name,
          whatsappMessageId: messageId || null,
          message_db_id: savedMsg?.id || null,
          io,
        });
        if (handledByRouter) return;

        const aiResult = await getOpenAIReply(
          tenant_id,
          phone,
          currentNormalizedMessage.messageText,
          contactsaved?.contact_id,
          phone_number_id,
          cachedData,
          messageId || null,
          {
            classifierResult: routingResult.classifierResult,
            routerMode,
            appointmentOperationDecision: routingResult.decision,
          },
        );

        // Log AI result for debugging UPDATE/CANCEL issues
        console.log(`[WEBHOOK] AI Result:`, {
          tagDetected: aiResult?.tagDetected || "NONE",
          tagPayloadPreview: aiResult?.tagPayload?.substring(0, 150) || "N/A",
          messagePreview: aiResult?.message?.substring(0, 200) || "N/A",
        });

        // If getOpenAIReply routed an appointment intent, send the Advanced Appointment response.
        const _apptTrace = {
          _appointmentResult: !!aiResult?._appointmentResult,
          tagDetected: aiResult?.tagDetected,
          msgPreview: String(aiResult?.message || "").substring(0, 60),
        };
        try {
          import("fs")
            .then((fs) =>
              fs.default.appendFileSync(
                "/tmp/faq_trace.log",
                `[${new Date().toISOString()}] [CONTROLLER] aiResult check ${JSON.stringify(_apptTrace)}\n`,
              ),
            )
            .catch(() => {});
        } catch {}
        console.log(
          "[FAQ-PIPELINE][CTRL] aiResult:",
          JSON.stringify(_apptTrace),
        );
        if (
          aiResult?._appointmentRoute &&
          isAppointmentOperationDecisionEnabled(
            aiResult._appointmentRoute,
            routerMode,
          )
        ) {
          const handledByAiSafetyRoute =
            await handleAppointmentOperationDecision({
              decision: aiResult._appointmentRoute,
              normalizedMessage: currentNormalizedMessage,
              tenant_id,
              phone,
              contactObj,
              contactsaved,
              phone_number_id,
              name,
              whatsappMessageId: messageId || null,
            });
          if (handledByAiSafetyRoute) return;
        }

        if (aiResult?._manageAppointmentResult) {
          await handleAdvancedAppointmentResponse(
            aiResult._manageAppointmentResult,
            tenant_id,
            phone,
            contactsaved,
            phone_number_id,
            name,
          );
          return;
        }

        if (aiResult?._appointmentResult) {
          await handleAdvancedAppointmentResponse(
            aiResult._appointmentResult,
            tenant_id,
            phone,
            contactsaved,
            phone_number_id,
            name,
          );
          return;
        }
        try {
          await updateLeadService(tenant_id, contactsaved?.contact_id, {
            sourceEvent: "user_message",
            message_id: savedMsg?.id,
            message_text: text,
            intentResult: {
              intent: aiResult?.intent,
              requires: aiResult?.requires,
              lead_intelligence: aiResult?.lead_intelligence,
            },
          });

          io.to(`tenant-${tenant_id}`).emit("lead-updated", {
            tenant_id,
            contact_id: contactsaved?.contact_id,
          });
        } catch (leadErr) {
          console.error(
            "[WEBHOOK] Failed to apply async intent lead-score update:",
            leadErr.message,
          );
        }

        const { messageToSend, tagToExecute, tagPayloadToExecute } =
          resolveAiReplyEnvelope(aiResult, text);

        // Send to WhatsApp FIRST — before saving the bot message.
        // This ensures that if the access token is invalid we do NOT create a
        // ghost message in the live-chat or trigger any downstream billing.
        if (
          await shouldDiscardAutomatedReply(
            tenant_id,
            contactsaved?.contact_id,
            aiReplyStartEpoch,
          )
        ) {
          console.log(
            `[REPEAT-GUARD] Discarding stale AI reply before send for ${phone}`,
          );
          getIO()
            .to(`tenant-${tenant_id}`)
            .emit("ai-typing", { tenant_id, phone, status: false });
          return;
        }
        let botMsgResponse = null;
        try {
          botMsgResponse = await sendWhatsAppMessage(
            tenant_id,
            phone,
            messageToSend,
          );
        } catch (sendErr) {
          if (sendErr.isTokenError) {
            console.error(
              `[WEBHOOK] Access token error for tenant ${tenant_id} — aborting bot reply, live-chat display skipped`,
            );
            // Clear typing indicator on dashboard
            const ioInst = getIO();
            ioInst
              .to(`tenant-${tenant_id}`)
              .emit("ai-typing", { tenant_id, phone, status: false });
            // Notify dashboard so the admin knows to refresh the token
            ioInst.to(`tenant-${tenant_id}`).emit("whatsapp-token-error", {
              tenant_id,
              message: sendErr.message,
              timestamp: new Date().toISOString(),
            });
            return; // Skip message save, socket emit, tag handler
          }
          // Non-token send error — log and fall through to still save the message
          console.error(
            "[WHATSAPP-SEND] Failed to send reply:",
            sendErr.message,
          );
          import("fs").then((fs) => {
            fs.appendFileSync(
              "whatsapp_send_error.log",
              `[${new Date().toISOString()}] To: ${phone} | Msg: ${messageToSend} | Error: ${sendErr.message}\n`,
            );
          });
        }

        const savedBotMsg = await createUserMessageService(
          tenant_id,
          contactsaved?.contact_id,
          phone_number_id,
          phone,
          botMsgResponse?.wamid || null,
          name,
          "bot",
          null,
          messageToSend,
          "text",
          null,
          null,
          botMsgResponse?.wamid ? "sent" : null,
        );

        const ioInstance = getIO();
        // Clear typing indicator before sending message to avoid overlap
        ioInstance.to(`tenant-${tenant_id}`).emit("ai-typing", {
          tenant_id,
          phone,
          status: false,
        });

        ioInstance.to(`tenant-${tenant_id}`).emit("new-message", {
          tenant_id,
          phone,
          id: savedBotMsg?.id,
          contact_id: contactsaved?.contact_id,
          phone_number_id,
          name: contactsaved?.name || name,
          message: messageToSend,
          message_type: "text",
          media_url: null,
          status: "sent",
          sender: "bot",
          created_at: new Date(),
        });

        // Execute tag handler AFTER sending the AI reply
        // This ensures correct message ordering (e.g., "Let me check..." before slots list)
        faqTrace("[CONTROLLER] pre-executeTagHandler", {
          tagToExecute: tagToExecute ?? null,
          isMissingInfo: resolveAiReplyEnvelope(aiResult, text)
            .isMissingInfoSignal,
          aiTag: aiResult?.tagDetected ?? null,
          msgPreview: String(aiResult?.message || "").substring(0, 60),
        });
        if (tagToExecute) {
          faqTrace("[CONTROLLER] ▶ invoking executeTagHandler", {
            tag: tagToExecute,
            payload: String(tagPayloadToExecute || "").substring(0, 100),
            tenant_id,
            phone,
            messageId: messageId || null,
            message_db_id: savedMsg?.id || null,
          });
          try {
            const { executeTagHandler } =
              await import("../../utils/ai/aiTagHandlers/index.js");
            await executeTagHandler(
              tagToExecute,
              tagPayloadToExecute,
              {
                tenant_id,
                contact_id: contactsaved?.contact_id,
                phone,
                phone_number_id,
                userMessage: text,
                messageId: messageId || null, // WhatsApp Message ID (wamid)
                message_db_id: savedMsg?.id || null, // Local database message ID
              },
              text,
            );
            faqTrace("[CONTROLLER] ✓ executeTagHandler completed", {
              tag: tagToExecute,
            });
          } catch (tagErr) {
            faqTrace("[CONTROLLER] ✗ executeTagHandler FAILED", {
              tag: tagToExecute,
              error: tagErr.message,
              stack: tagErr.stack?.substring(0, 300),
            });
          }
        } else {
          faqTrace("[CONTROLLER] ✗ tagToExecute is null — FAQ NOT created", {
            aiTag: aiResult?.tagDetected ?? null,
          });
        }
      } catch (err) {
        console.error("Background AI error:", err);
      } finally {
        await unlockChat(tenant_id, phone_number_id, phone);
        // Deactivate Typing Animation on Dashboard
        try {
          const io = getIO();
          if (io) {
            io.to(`tenant-${tenant_id}`).emit("ai-typing", {
              tenant_id,
              phone,
              status: false,
            });
          }
        } catch (socketErr) {
          console.error("[SOCKET] AI typing emit failed:", socketErr.message);
        }

        // Process queued message if any (user sent more messages while AI was processing)
        const pending = consumePendingMessage(tenant_id, phone);
        if (
          pending &&
          (await shouldDiscardAutomatedReply(
            tenant_id,
            pending.contact_id || contactsaved?.contact_id,
          ))
        ) {
          console.log(
            `[REPEAT-GUARD] Dropping queued reactive AI for ${phone} (paused) — not replayed`,
          );
        } else if (pending) {
          console.log(`[WEBHOOK] Processing queued message for ${phone}`);
          const reLock = await tryAcquireLock(
            tenant_id,
            phone_number_id,
            phone,
          );
          if (reLock) {
            setImmediate(async () => {
              try {
                const queuedContactObj = {
                  ...(pending.contactsaved || {}),
                  contact_id: pending.contact_id,
                  phone_number: phone,
                  phone,
                };
                const queuedInteractiveReplyId = pending.buttonReplyId || null;
                const queuedNormalizedMessage =
                  pending.normalizedMessage ||
                  normalizeAppointmentOperationInput({
                    messageText: pending.text || "",
                    buttonReplyId: queuedInteractiveReplyId,
                    messageType: pending.type || "text",
                    rawPayload: pending.rawPayload || null,
                  });
                const queuedActiveManageAppointmentSession =
                  await hasActiveManageAppointmentSession({
                    tenantId: tenant_id,
                    userPhone: phone,
                  }).catch(() => false);
                if (
                  !queuedActiveManageAppointmentSession &&
                  isDoctorListTemplateRequest({
                    text: pending.text || "",
                    replyId: queuedInteractiveReplyId,
                  })
                ) {
                  await expireAdvancedAppointmentSessionIfNeeded({
                    tenant_id,
                    phone,
                    contactObj: queuedContactObj,
                    message: pending.text || "",
                    whatsappMessageId: pending.messageId || null,
                  });
                  const doctorListResult =
                    await buildAvailableDoctorListAppointmentResponse({
                      tenantId: tenant_id,
                      userPhone: phone,
                    });
                  await handleAdvancedAppointmentResponse(
                    doctorListResult,
                    tenant_id,
                    phone,
                    pending.contactsaved || null,
                    phone_number_id,
                    pending.name || pending.contactsaved?.name || null,
                  );
                  return;
                }

                // Check wallet before processing queued message
                const queuedWalletCheck = await canUseAI(tenant_id, 0.5);
                if (!queuedWalletCheck.allowed) {
                  console.log(
                    `[WEBHOOK] Wallet blocked for queued msg, tenant ${tenant_id}`,
                  );
                  await unlockChat(tenant_id, phone_number_id, phone);
                  return;
                }

                sendTypingIndicator(
                  tenant_id,
                  phone_number_id,
                  phone,
                  pending.messageId,
                );

                console.log("AI started for:", phone);

                const {
                  handled: queuedHandledByRouter,
                  routingResult: queuedRoutingResult,
                  routerMode: queuedRouterMode,
                } = await routeAndMaybeHandleAppointmentOperation({
                  tenant_id,
                  phone,
                  contact_id: pending.contact_id,
                  normalizedMessage: queuedNormalizedMessage,
                  contactObj: queuedContactObj,
                  contactsaved: pending.contactsaved || null,
                  phone_number_id,
                  name: pending.name || pending.contactsaved?.name || null,
                  whatsappMessageId: pending.messageId || null,
                  message_db_id: pending.message_db_id || null,
                  io,
                });
                if (queuedHandledByRouter) return;

                const aiResult = await getOpenAIReply(
                  tenant_id,
                  phone,
                  queuedNormalizedMessage.messageText,
                  pending.contact_id,
                  phone_number_id,
                  {}, // cachedData
                  pending.messageId || null,
                  {
                    classifierResult: queuedRoutingResult.classifierResult,
                    routerMode: queuedRouterMode,
                    appointmentOperationDecision: queuedRoutingResult.decision,
                  },
                );

                if (
                  aiResult?._appointmentRoute &&
                  isAppointmentOperationDecisionEnabled(
                    aiResult._appointmentRoute,
                    queuedRouterMode,
                  )
                ) {
                  const queuedHandledByAiSafetyRoute =
                    await handleAppointmentOperationDecision({
                      decision: aiResult._appointmentRoute,
                      normalizedMessage: queuedNormalizedMessage,
                      tenant_id,
                      phone,
                      contactObj: queuedContactObj,
                      contactsaved: pending.contactsaved || null,
                      phone_number_id,
                      name: pending.name || pending.contactsaved?.name || null,
                      whatsappMessageId: pending.messageId || null,
                    });
                  if (queuedHandledByAiSafetyRoute) return;
                }

                if (aiResult?._manageAppointmentResult) {
                  await handleAdvancedAppointmentResponse(
                    aiResult._manageAppointmentResult,
                    tenant_id,
                    phone,
                    pending.contactsaved || null,
                    phone_number_id,
                    pending.name || pending.contactsaved?.name || null,
                  );
                  return;
                }

                if (aiResult?._appointmentResult) {
                  await handleAdvancedAppointmentResponse(
                    aiResult._appointmentResult,
                    tenant_id,
                    phone,
                    pending.contactsaved || null,
                    phone_number_id,
                    pending.name || pending.contactsaved?.name || null,
                  );
                  return;
                }

                try {
                  await updateLeadService(tenant_id, pending.contact_id, {
                    sourceEvent: "user_message",
                    message_text: pending.text,
                    intentResult: {
                      intent: aiResult?.intent,
                      requires: aiResult?.requires,
                      lead_intelligence: aiResult?.lead_intelligence,
                    },
                  });

                  io.to(`tenant-${tenant_id}`).emit("lead-updated", {
                    tenant_id,
                    contact_id: pending.contact_id,
                  });
                } catch (leadErr) {
                  console.error(
                    "[WEBHOOK] Failed queued async lead-score update:",
                    leadErr.message,
                  );
                }

                const {
                  messageToSend,
                  tagToExecute: queuedTagToExecute,
                  tagPayloadToExecute: queuedTagPayloadToExecute,
                } = resolveAiReplyEnvelope(aiResult, pending.text);

                if (
                  messageToSend &&
                  (await shouldDiscardAutomatedReply(
                    tenant_id,
                    pending.contact_id || contactsaved?.contact_id,
                  ))
                ) {
                  console.log(
                    `[REPEAT-GUARD] Discarding stale queued AI reply before send for ${phone}`,
                  );
                } else if (messageToSend) {
                  // Send to WhatsApp FIRST — abort if token error
                  let botMsgResponse = null;
                  try {
                    botMsgResponse = await sendWhatsAppMessage(
                      tenant_id,
                      phone,
                      messageToSend,
                    );
                  } catch (sendErr) {
                    if (sendErr.isTokenError) {
                      console.error(
                        `[WEBHOOK] Access token error (queued msg) for tenant ${tenant_id} — aborting bot reply`,
                      );
                      const io = getIO();
                      io.to(`tenant-${tenant_id}`).emit("ai-typing", {
                        tenant_id,
                        phone,
                        status: false,
                      });
                      io.to(`tenant-${tenant_id}`).emit(
                        "whatsapp-token-error",
                        {
                          tenant_id,
                          message: sendErr.message,
                          timestamp: new Date().toISOString(),
                        },
                      );
                      return;
                    }
                    console.error(
                      "[WEBHOOK] Queued send failed:",
                      sendErr.message,
                    );
                  }

                  const savedBotMsg = await createUserMessageService(
                    tenant_id,
                    pending.contact_id,
                    phone_number_id,
                    phone,
                    botMsgResponse?.wamid || null,
                    pending.contactsaved?.name || "Bot",
                    "bot",
                    null,
                    messageToSend,
                    "text",
                    null,
                    null,
                    botMsgResponse?.wamid ? "sent" : null,
                  );

                  const io = getIO();
                  io.to(`tenant-${tenant_id}`).emit("ai-typing", {
                    tenant_id,
                    phone,
                    status: false,
                  });
                  io.to(`tenant-${tenant_id}`).emit("new-message", {
                    tenant_id,
                    phone,
                    id: savedBotMsg?.id,
                    contact_id: pending.contact_id,
                    phone_number_id,
                    name: pending.contactsaved?.name || "Bot",
                    message: messageToSend,
                    message_type: "text",
                    media_url: null,
                    status: "sent",
                    sender: "bot",
                    created_at: new Date(),
                  });

                  if (queuedTagToExecute) {
                    faqTrace(
                      "[CONTROLLER][QUEUED] ▶ invoking executeTagHandler",
                      {
                        tag: queuedTagToExecute,
                        payload: String(
                          queuedTagPayloadToExecute || "",
                        ).substring(0, 100),
                        tenant_id,
                        phone,
                      },
                    );
                    try {
                      const { executeTagHandler } =
                        await import("../../utils/ai/aiTagHandlers/index.js");
                      await executeTagHandler(
                        queuedTagToExecute,
                        queuedTagPayloadToExecute,
                        {
                          tenant_id,
                          contact_id: pending.contact_id,
                          phone,
                          phone_number_id,
                          userMessage: pending.text,
                          messageId: pending.messageId || null,
                          message_db_id: pending.message_db_id || null,
                        },
                        pending.text,
                      );
                      faqTrace(
                        "[CONTROLLER][QUEUED] ✓ executeTagHandler completed",
                        { tag: queuedTagToExecute },
                      );
                    } catch (tagErr) {
                      faqTrace(
                        "[CONTROLLER][QUEUED] ✗ executeTagHandler FAILED",
                        {
                          tag: queuedTagToExecute,
                          error: tagErr.message,
                          stack: tagErr.stack?.substring(0, 300),
                        },
                      );
                    }
                  }
                }
              } catch (qErr) {
                console.error(
                  "[WEBHOOK] Queued message AI error:",
                  qErr.message,
                );
              } finally {
                await unlockChat(tenant_id, phone_number_id, phone);
                try {
                  const io = getIO();
                  if (io) {
                    io.to(`tenant-${tenant_id}`).emit("ai-typing", {
                      tenant_id,
                      phone,
                      status: false,
                    });
                  }
                } catch (_) {}
              }
            });
          }
        }
      }
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
};

async function applyAppointmentRouterLeadUpdate({
  tenant_id,
  contact_id,
  message_id = null,
  message_text = "",
  routingResult,
  io = null,
}) {
  const classifierResult = routingResult?.classifierResult;
  if (!tenant_id || !contact_id || !classifierResult) return;
  try {
    await updateLeadService(tenant_id, contact_id, {
      sourceEvent: "user_message",
      message_id,
      message_text,
      intentResult: {
        intent: classifierResult.intent,
        requires: classifierResult.requires,
        lead_intelligence: classifierResult.lead_intelligence,
      },
    });
    const ioInstance = io || getIO();
    ioInstance.to(`tenant-${tenant_id}`).emit("lead-updated", {
      tenant_id,
      contact_id,
    });
  } catch (leadErr) {
    console.error(
      "[APPOINTMENT_OPERATION_ROUTER] Lead update failed:",
      leadErr.message,
    );
  }
}

async function routeAndMaybeHandleAppointmentOperation({
  tenant_id,
  phone,
  contact_id,
  normalizedMessage,
  contactObj,
  contactsaved = null,
  phone_number_id = null,
  name = null,
  whatsappMessageId = null,
  message_db_id = null,
  io = null,
}) {
  const routerMode = getAppointmentOperationRouterMode();
  const routingResult = await routeAppointmentOperation({
    tenantId: tenant_id,
    phone,
    contactId: contact_id,
    normalizedMessage,
  });
  logAppointmentOperationRouterDecision({
    tenantId: tenant_id,
    phone,
    normalizedMessage,
    routingResult,
    mode: routerMode,
  });

  if (
    !isAppointmentOperationDecisionEnabled(routingResult.decision, routerMode)
  ) {
    return { handled: false, routingResult, routerMode };
  }

  const handledBookingToManageSwitch = await maybeHandleBookingToManageSwitch({
    tenant_id,
    phone,
    contactObj,
    contactsaved,
    phone_number_id,
    name,
    whatsappMessageId,
    routingResult,
    normalizedMessage,
  });
  if (handledBookingToManageSwitch) {
    return { handled: true, routingResult, routerMode };
  }

  await closeSupersededAppointmentSession({
    tenant_id,
    phone,
    routingResult,
    normalizedMessage,
  });

  await applyAppointmentRouterLeadUpdate({
    tenant_id,
    contact_id,
    message_id: message_db_id,
    message_text:
      normalizeAppointmentOperationInput(normalizedMessage).messageText,
    routingResult,
    io,
  });

  if (
    routingResult.decision?.route ===
    APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT
  ) {
    const bookingSettings =
      await getAppointmentBookingAutomationSettings(tenant_id);
    console.log(
      `[APPOINTMENT_ENGINE] tenant=${tenant_id} type=${bookingSettings.appointment_booking_type}`,
    );
    if (
      shouldUseAppointmentAiAgent({
        appointmentBookingType: bookingSettings.appointment_booking_type,
        appointmentIntake: routingResult.aiAppointmentIntake,
      })
    ) {
      const aiBookingResult = await handleAppointmentBookingAiAgent({
        tenantId: tenant_id,
        userPhone: phone,
        contact: contactObj || contactsaved || null,
        message:
          normalizeAppointmentOperationInput(normalizedMessage).messageText,
        whatsappMessageId,
      });

      logAppointmentOperationDispatch({
        tenantId: tenant_id,
        phone,
        messageId: whatsappMessageId,
        decision: routingResult.decision,
        result: aiBookingResult,
      });
      await handleAdvancedAppointmentResponse(
        aiBookingResult,
        tenant_id,
        phone,
        contactsaved,
        phone_number_id,
        name,
      );
      return { handled: true, routingResult, routerMode };
    }
  }

  const handled = await handleAppointmentOperationDecision({
    decision: routingResult.decision,
    normalizedMessage,
    tenant_id,
    phone,
    contactObj,
    contactsaved,
    phone_number_id,
    name,
    whatsappMessageId,
  });

  return { handled, routingResult, routerMode };
}

const isManageSwitchRequestFromBooking = (normalizedMessage = {}) => {
  const input = normalizeAppointmentOperationInput(normalizedMessage);
  return isManageSwitchRequestFromBookingReplyId(input.buttonReplyId);
};

async function maybeHandleBookingToManageSwitch({
  tenant_id,
  phone,
  contactObj,
  contactsaved = null,
  phone_number_id = null,
  name = null,
  whatsappMessageId = null,
  routingResult,
  normalizedMessage,
}) {
  const activeBookingSession = routingResult?.activeBookingSession || null;
  if (!activeBookingSession) return false;

  const input = normalizeAppointmentOperationInput(normalizedMessage);
  const replyId = String(input.buttonReplyId || "").trim();

  if (replyId === BOOKING_TO_MANAGE_SWITCH_REPLY_IDS.CONFIRM) {
    await closeBookingSessionSilently(activeBookingSession);
    const manageResult = await handleManageBookedAppointments({
      tenantId: tenant_id,
      userPhone: phone,
      contact: contactObj,
      message: "view_my_appointments",
      interactiveReplyId: "view_my_appointments",
      intent: "MANAGE_APPOINTMENTS_ACTION",
      whatsappMessageId,
    });
    await handleAdvancedAppointmentResponse(
      manageResult,
      tenant_id,
      phone,
      contactsaved,
      phone_number_id,
      name,
    );
    return true;
  }

  if (replyId === BOOKING_TO_MANAGE_SWITCH_REPLY_IDS.CANCEL) {
    const bookingResult = await handleAdvancedAppointmentBooking({
      tenantId: tenant_id,
      userPhone: phone,
      contact: contactObj,
      message: "continue_appointment",
      interactiveReplyId: "continue_appointment",
      whatsappMessageId,
    });
    await handleAdvancedAppointmentResponse(
      bookingResult,
      tenant_id,
      phone,
      contactsaved,
      phone_number_id,
      name,
    );
    return true;
  }

  if (
    routingResult?.decision?.route ===
      APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT &&
    isManageSwitchRequestFromBooking(input)
  ) {
    await sendAppointmentPayload(
      tenant_id,
      buildBookingToManageSwitchConfirmPayload(phone),
    );
    return true;
  }

  return false;
}

const closeBookingSessionSilently = async (session) => {
  if (!session) return;
  try {
    await releaseLockedSlots(session.session_id);
    await cancelAppointmentSession(session);
  } catch (err) {
    console.error(
      "[APPOINTMENT_OPERATION_ROUTER] Silent booking session close failed:",
      err.message,
    );
  }
};

const closeManageSessionSilently = async (session) => {
  if (!session) return;
  try {
    await releaseLockedSlots(session.session_id);
    await clearManageAppointmentSession(
      session,
      MANAGE_APPOINTMENT_SESSION_STATUS.CANCELLED,
    );
  } catch (err) {
    console.error(
      "[APPOINTMENT_OPERATION_ROUTER] Silent manage session close failed:",
      err.message,
    );
  }
};

async function closeSupersededAppointmentSession({
  routingResult,
  normalizedMessage,
}) {
  const decision = routingResult?.decision;
  if (!decision?.shouldHandle) return;

  const input = normalizeAppointmentOperationInput(normalizedMessage);
  const activeBookingSession = routingResult?.activeBookingSession || null;
  const activeManageSession = routingResult?.activeManageSession || null;

  if (decision.route === APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT) {
    await closeBookingSessionSilently(activeBookingSession);
    return;
  }

  if (decision.route !== APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT) return;

  if (activeManageSession) {
    await closeManageSessionSilently(activeManageSession);
    return;
  }

  if (activeBookingSession && input.buttonReplyId === "create_appointment") {
    await closeBookingSessionSilently(activeBookingSession);
  }
}

const canonicalizeBookingOperationMessage = ({
  decision,
  normalizedMessage,
}) => {
  const input = normalizeAppointmentOperationInput(normalizedMessage);
  if (input.buttonReplyId) return input.effectiveText;
  switch (decision?.action) {
    case "confirm":
      return "confirm_booking";
    case "reject":
    case "cancel":
    case "exit":
      return "cancel_booking";
    case "continue":
      return "continue_appointment";
    case "edit":
      return "edit_details";
    default:
      return input.effectiveText || "create_appointment";
  }
};

const isManageCanonicalReplyId = (value = "") => {
  const id = String(value || "").trim();
  return (
    id === "view_my_appointments" ||
    id.startsWith("manage_appt_") ||
    id.startsWith("appt_") ||
    id.startsWith("confirm_cancel_") ||
    id.startsWith("confirm_reschedule_")
  );
};

const getAppointmentResponsePayloadCount = (result) => {
  if (Array.isArray(result?.payloads)) return result.payloads.length;
  if (result?.payload) return 1;
  if (result?.message) return 1;
  return 0;
};

const logAppointmentOperationDispatch = ({
  tenantId,
  phone,
  messageId = null,
  decision,
  result,
}) => {
  try {
    console.log(
      "[APPOINTMENT_OPERATION_DISPATCH]",
      JSON.stringify({
        tenantId,
        phone,
        messageId,
        route: decision?.route || null,
        action: decision?.action || null,
        source: decision?.source || null,
        responsePayloadCount: getAppointmentResponsePayloadCount(result),
      }),
    );
  } catch (err) {
    console.log("[APPOINTMENT_OPERATION_DISPATCH]", {
      tenantId,
      phone,
      messageId,
      route: decision?.route || null,
      action: decision?.action || null,
      source: decision?.source || null,
      responsePayloadCount: getAppointmentResponsePayloadCount(result),
    });
  }
};

async function handleAppointmentOperationDecision({
  decision,
  normalizedMessage,
  tenant_id,
  phone,
  contactObj,
  contactsaved = null,
  phone_number_id = null,
  name = null,
  whatsappMessageId = null,
}) {
  if (!decision?.shouldHandle) return false;
  const input = normalizeAppointmentOperationInput(normalizedMessage);
  const legacyReplyId = input.buttonReplyId || input.effectiveText;

  if (
    ["confirm_yes", "confirm_no"].includes(legacyReplyId) &&
    (contactsaved?.contact_id || contactObj?.contact_id)
  ) {
    const legacyConfirmSession = await db.BookingSessions.findOne({
      where: {
        contact_id: contactsaved?.contact_id || contactObj?.contact_id,
        tenant_id,
        status: "active",
        flow_type: ["edit", "cancel"],
        current_step: "confirming",
      },
      order: [["updatedAt", "DESC"]],
    });
    if (legacyConfirmSession) {
      const confirmResult = await handleLegacyAppointmentConfirmation(
        input.effectiveText,
        contactObj,
        tenant_id,
      );
      if (confirmResult) {
        logAppointmentOperationDispatch({
          tenantId: tenant_id,
          phone,
          messageId: whatsappMessageId,
          decision,
          result: confirmResult,
        });
        await handleAppointmentResponse(
          confirmResult,
          tenant_id,
          phone,
          contactsaved,
          phone_number_id,
          name,
        );
        return true;
      }
    }
  }

  if (
    input.buttonReplyId &&
    input.buttonReplyId !== "view_my_appointments" &&
    input.buttonReplyId !== "cancel_appointment" &&
    isLegacyAppointmentManagementReplyId(input.buttonReplyId)
  ) {
    const legacyIntent = getLegacyAppointmentIntentForReply(
      input.buttonReplyId,
    );
    if (legacyIntent) {
      const legacyResult = await handleLegacyAppointmentIntent(
        legacyIntent,
        input.effectiveText,
        contactObj,
        tenant_id,
      );
      logAppointmentOperationDispatch({
        tenantId: tenant_id,
        phone,
        messageId: whatsappMessageId,
        decision,
        result: legacyResult,
      });
      await handleAppointmentResponse(
        legacyResult,
        tenant_id,
        phone,
        contactsaved,
        phone_number_id,
        name,
      );
      return true;
    }
  }

  if (decision.route === APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT) {
    const bookingMessage = canonicalizeBookingOperationMessage({
      decision,
      normalizedMessage: input,
    });
    const advancedResult = await handleAdvancedAppointmentBooking({
      tenantId: tenant_id,
      userPhone: phone,
      contact: contactObj,
      message: bookingMessage,
      interactiveReplyId: input.buttonReplyId,
      whatsappMessageId,
    });
    if (advancedResult?.handoverToNormalRouter) return false;
    logAppointmentOperationDispatch({
      tenantId: tenant_id,
      phone,
      messageId: whatsappMessageId,
      decision,
      result: advancedResult,
    });
    await handleAdvancedAppointmentResponse(
      advancedResult,
      tenant_id,
      phone,
      contactsaved,
      phone_number_id,
      name,
    );
    return true;
  }

  if (decision.route === APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT) {
    const manageMessage = canonicalizeManageOperationMessage({
      decision,
      normalizedMessage: input,
    });
    const manageReplyId =
      input.buttonReplyId ||
      (isManageCanonicalReplyId(manageMessage) ? manageMessage : null);
    try {
      console.log(
        "[MANAGE_APPOINTMENT_DISPATCH]",
        JSON.stringify({
          phone,
          messageText: input.messageText,
          buttonReplyId: input.buttonReplyId || null,
          manageMessage,
          manageReplyId,
          decisionAction: decision.action,
          decisionSource: decision.source,
          decisionReason: decision.reason,
          activeManageSession: Boolean(routingResult?.activeManageSession),
          activeManageState: routingResult?.activeManageSession?.state || null,
        }),
      );
    } catch (_) {}
    const manageResult = await handleManageBookedAppointments({
      tenantId: tenant_id,
      userPhone: phone,
      contact: contactObj,
      message: manageMessage,
      interactiveReplyId: manageReplyId,
      intent: "MANAGE_APPOINTMENTS_ACTION",
      whatsappMessageId,
    });
    if (manageResult?.handoverToNormalRouter) return false;
    if (manageResult?.handoverToBooking) {
      const bookingSettings =
        await getAppointmentBookingAutomationSettings(tenant_id);
      console.log(
        `[APPOINTMENT_ENGINE] tenant=${tenant_id} type=${bookingSettings.appointment_booking_type}`,
      );
      const advancedResult =
        bookingSettings.appointment_booking_type ===
        APPOINTMENT_BOOKING_TYPES.AI_AGENT
          ? await handleAppointmentBookingAiAgent({
              tenantId: tenant_id,
              userPhone: phone,
              contact: contactObj,
              message: "I want to book another appointment.",
            })
          : await handleAdvancedAppointmentBooking({
              tenantId: tenant_id,
              userPhone: phone,
              contact: contactObj,
              message: "create_appointment",
              interactiveReplyId: "create_appointment",
              whatsappMessageId,
            });
      logAppointmentOperationDispatch({
        tenantId: tenant_id,
        phone,
        messageId: whatsappMessageId,
        decision,
        result: advancedResult,
      });
      await handleAdvancedAppointmentResponse(
        advancedResult,
        tenant_id,
        phone,
        contactsaved,
        phone_number_id,
        name,
      );
      return true;
    }
    logAppointmentOperationDispatch({
      tenantId: tenant_id,
      phone,
      messageId: whatsappMessageId,
      decision,
      result: manageResult,
    });
    await handleAdvancedAppointmentResponse(
      manageResult,
      tenant_id,
      phone,
      contactsaved,
      phone_number_id,
      name,
    );
    return true;
  }

  return false;
}

async function expireAdvancedAppointmentSessionIfNeeded({
  tenant_id,
  phone,
  contactObj,
  message = "",
  whatsappMessageId = null,
}) {
  const activeAdvancedSession = await getActiveAppointmentSession({
    tenantId: tenant_id,
    contactId: contactObj?.contact_id,
    userPhone: phone,
  });

  if (!activeAdvancedSession || !isSessionExpired(activeAdvancedSession)) {
    return false;
  }

  await handleAdvancedAppointmentBooking({
    tenantId: tenant_id,
    userPhone: phone,
    contact: contactObj,
    message,
    interactiveReplyId: null,
    whatsappMessageId,
  });
  return true;
}

async function handleAdvancedAppointmentResponse(
  result,
  tenant_id,
  phone,
  contactsaved = null,
  phone_number_id = null,
  name = null,
) {
  if (!result) return;
  if (await shouldDiscardAutomatedReply(tenant_id, contactsaved?.contact_id)) {
    try {
      getIO()
        .to(`tenant-${tenant_id}`)
        .emit("ai-typing", { tenant_id, phone, status: false });
    } catch {}
    console.log(
      `[REPEAT-GUARD] Discarding stale advanced appointment response for ${phone}`,
    );
    return;
  }
  if (result.suppressResponse || result.duplicate || result.alreadyProcessed) {
    try {
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("ai-typing", {
        tenant_id,
        phone,
        status: false,
      });
    } catch {}
    return;
  }

  const fallbackPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "text",
    text: { preview_url: false, body: result.message || "Done." },
  };
  const payloads =
    Array.isArray(result.payloads) && result.payloads.length
      ? result.payloads
      : [result.payload || fallbackPayload];

  const persistSentPayload = async (payload, wamid) => {
    const textToSave =
      payload?.text?.body ||
      payload?.interactive?.body?.text ||
      result.message ||
      "Appointment action processed.";
    const messageTypeToSave =
      payload.type === "interactive" ? "interactive" : "text";
    const interactive_payload =
      payload.type === "interactive"
        ? JSON.stringify(payload)
        : result.event === "appointment_ai_agent"
          ? JSON.stringify({
              event: result.event,
              appointmentAiAction: result.appointmentAiAction,
              appointment_intake: result.appointment_intake,
            })
          : null;
    const contact_id = contactsaved?.contact_id || null;
    const savedBotMsg = contact_id
      ? await createUserMessageService(
          tenant_id,
          contact_id,
          phone_number_id,
          phone,
          wamid,
          name,
          "bot",
          null,
          textToSave,
          messageTypeToSave,
          null,
          null,
          wamid ? "sent" : null,
          null,
          null,
          interactive_payload,
        )
      : null;

    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("ai-typing", {
      tenant_id,
      phone,
      status: false,
    });
    io.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone,
      id: savedBotMsg?.id || null,
      contact_id,
      phone_number_id,
      name: contactsaved?.name || name || null,
      message: textToSave,
      message_type: messageTypeToSave,
      interactive_payload,
      media_url: null,
      status: wamid ? "sent" : null,
      sender: "bot",
      created_at: new Date(),
    });
  };

  try {
    for (const payload of payloads) {
      const wamid = await sendAppointmentPayload(tenant_id, payload);
      try {
        await persistSentPayload(payload, wamid);
      } catch (dbErr) {
        console.error(
          "[ADV-APPT-RESPONSE] DB/socket persistence failed:",
          dbErr.message,
        );
      }
    }
  } catch (err) {
    console.error(
      "[ADV-APPT-RESPONSE] Failed to send appointment payload:",
      err.message,
    );
    try {
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("ai-typing", {
        tenant_id,
        phone,
        status: false,
      });
      io.to(`tenant-${tenant_id}`).emit("appointment_failed", {
        tenantId: tenant_id,
        userPhone: phone,
        sessionId: result.session?.session_id || null,
        state: result.session?.state || null,
        status: result.session?.status || null,
        reason: err.message,
        updatedAt: new Date(),
      });
      if (err.isTokenError) {
        io.to(`tenant-${tenant_id}`).emit("whatsapp-token-error", {
          tenant_id,
          message: err.message,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {}
    return;
  }
}

// NEW: Route an appointment orchestrator result to the correct WhatsApp message type.
// Also saves the bot message to the DB and emits to the dashboard socket.
async function handleAppointmentResponse( // NEW
  result,
  tenant_id,
  phone, // NEW
  contactsaved = null,
  phone_number_id = null,
  name = null, // NEW
) {
  // NEW
  if (!result) return; // NEW

  if (await shouldDiscardAutomatedReply(tenant_id, contactsaved?.contact_id)) {
    try {
      getIO()
        .to(`tenant-${tenant_id}`)
        .emit("ai-typing", { tenant_id, phone, status: false });
    } catch {}
    console.log(
      `[REPEAT-GUARD] Discarding stale appointment response for ${phone}`,
    );
    return;
  }

  // Determine the plain-text version to save to the messages DB
  const textToSave = result.message || "Appointment action processed."; // NEW
  const isInteractive = Boolean(result.buttonType); // NEW
  let interactive_payload = null; // NEW
  if (isInteractive) {
    // NEW
    try {
      // NEW
      interactive_payload = JSON.stringify({
        // NEW
        buttonType: result.buttonType, // NEW
        slots: result.slots || null, // NEW
        doctors: result.doctors || null, // NEW
        appointments: result.appointments || null, // NEW
        // NEW
        buttons:
          result.buttonType === "confirmation" ||
          result.buttonType === "cancel_confirmation" // NEW
            ? [{ title: "Confirm" }, { title: "Cancel" }] // NEW
            : result.buttonType === "greeting_menu" // NEW
              ? [
                  // NEW
                  { title: "Book appointment" }, // NEW
                  { title: "My appointments" }, // NEW
                  { title: "Cancel / Reschedule" }, // NEW
                ] // NEW
              : result.buttonType === "book_prompt" // NEW
                ? [{ title: "Book appointment" }] // NEW
                : result.buttonType === "post_booking" // NEW
                  ? [{ title: "My appointments" }, { title: "Book another" }] // NEW
                  : null, // NEW
      }); // NEW
    } catch {
      // NEW
      interactive_payload = null; // NEW
    } // NEW
  } // NEW

  try {
    // NEW
    // ── Send the WhatsApp message (interactive or plain text) ─────────────
    if (
      result.buttonType === "confirmation" ||
      result.buttonType === "cancel_confirmation"
    ) {
      // NEW
      await sendQuickReply(tenant_id, phone, result.message, [
        // NEW
        { id: "confirm_yes", title: "Confirm" }, // NEW
        { id: "confirm_no", title: "Cancel" }, // NEW
      ]); // NEW
    } else if (result.buttonType === "slot_selection" && result.slots?.length) {
      // NEW
      const rows = result.slots.slice(0, 10).map((s) => ({
        // NEW
        id:
          s.id ||
          (s.time
            ? "SLOT_" + encodeSlotTime(s.time).replace(/-/g, "_").toUpperCase()
            : ""), // NEW
        title: s.title || s.time, // NEW
        description: s.description || "", // NEW
      })); // NEW
      await sendListMessage(
        // NEW
        tenant_id,
        phone, // NEW
        result.message || "Please choose an available time slot.", // NEW
        "Pick a Time", // NEW
        [{ title: result.slotSectionTitle || "Available Time Slots", rows }], // NEW
      ); // NEW
    } else if (result.buttonType === "doctor_list" && result.doctors?.length) {
      // NEW
      const rows = result.doctors.slice(0, 10).map((d) => ({
        // NEW
        id: "doctor_" + d.id, // NEW
        title: "Dr. " + d.name, // NEW
        description: d.specialization || "", // NEW
      })); // NEW
      await sendListMessage(
        // NEW
        tenant_id,
        phone, // NEW
        "Please choose a doctor:", // NEW
        "View doctors", // NEW
        [{ title: "Available doctors", rows }], // NEW
      ); // NEW
    } else if (
      result.buttonType === "appointment_actions" &&
      result.appointments?.length
    ) {
      // NEW
      for (const apt of result.appointments) {
        // NEW
        await sendAppointmentCard(tenant_id, phone, apt); // NEW
      } // NEW
    } else if (result.buttonType === "greeting_menu") {
      // NEW
      await sendQuickReply(tenant_id, phone, result.message, [
        // NEW
        { id: "create_appointment", title: "Book appointment" }, // NEW
        { id: "view_my_appointments", title: "My appointments" }, // NEW
        { id: "cancel_appointment", title: "Cancel / Reschedule" }, // NEW
      ]); // NEW
    } else if (result.buttonType === "book_prompt") {
      // NEW
      await sendQuickReply(tenant_id, phone, result.message, [
        // NEW
        { id: "create_appointment", title: "Book appointment" }, // NEW
      ]); // NEW
    } else if (result.buttonType === "post_booking") {
      // NEW
      await sendQuickReply(tenant_id, phone, result.message, [
        // NEW
        { id: "view_my_appointments", title: "My appointments" }, // NEW
        { id: "create_appointment", title: "Book another" }, // NEW
      ]); // NEW
    } else {
      // NEW
      await sendWhatsAppMessage(tenant_id, phone, result.message || "Done."); // NEW
    } // NEW
  } catch (err) {
    // NEW
    console.error(
      "[APPT-RESPONSE] Failed to send appointment response:",
      err.message,
    ); // NEW
    await sendWhatsAppMessage(
      tenant_id,
      phone,
      result.message || "Done.",
    ).catch(() => {}); // NEW
  } // NEW

  // ── Persist bot message to DB + emit to dashboard socket ──────────────
  try {
    // NEW
    const contact_id = contactsaved?.contact_id || null; // NEW
    const messageTypeToSave = isInteractive ? "interactive" : "text"; // NEW
    const savedBotMsg = contact_id // NEW
      ? await createUserMessageService(
          // NEW
          tenant_id,
          contact_id,
          phone_number_id, // NEW
          phone,
          null,
          name,
          "bot",
          null, // NEW
          textToSave,
          messageTypeToSave,
          null,
          null,
          null,
          null,
          null,
          interactive_payload, // NEW
        ) // NEW
      : null; // NEW

    const io = getIO(); // NEW
    io.to(`tenant-${tenant_id}`).emit("ai-typing", {
      tenant_id,
      phone,
      status: false,
    }); // NEW
    io.to(`tenant-${tenant_id}`).emit("new-message", {
      // NEW
      tenant_id,
      phone, // NEW
      id: savedBotMsg?.id || null, // NEW
      contact_id,
      phone_number_id, // NEW
      name: contactsaved?.name || name || null, // NEW
      message: textToSave, // NEW
      message_type: messageTypeToSave,
      interactive_payload,
      media_url: null, // NEW
      status: "sent",
      sender: "bot", // NEW
      created_at: new Date(), // NEW
    }); // NEW
  } catch (dbErr) {
    // NEW
    console.error(
      "[APPT-RESPONSE] DB/socket persistence failed:",
      dbErr.message,
    ); // NEW
  } // NEW
} // NEW

// NEW: Encode a time string like "09:00 AM" → "09-00-AM" for use in button IDs
// Avoids colons and spaces which some parsers reject in IDs.
function encodeSlotTime(time) {
  // Pad single-digit hour: "9:00 AM" → "09:00 AM" first, then replace separators
  return String(time)
    .replace(/^(\d):/, "0$1:") // "9:00 AM" → "09:00 AM"
    .replace(/:/g, "-") // "09:00 AM" → "09-00 AM"
    .replace(/\s+/g, "-"); // "09-00 AM" → "09-00-AM"
}

// Reverse encodeSlotTime: "09-00-AM" → "09:00 AM"
function decodeSlotTime(encoded) {
  // Accepts both 1 and 2 digit hours for safety
  return String(encoded).replace(
    /^(\d{1,2})-(\d{2})-([AP]M)$/,
    (_, h, m, p) => `${h.padStart(2, "0")}:${m} ${p}`,
  );
}
