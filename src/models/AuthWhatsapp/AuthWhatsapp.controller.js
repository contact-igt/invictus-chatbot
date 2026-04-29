import { createUserMessageService } from "../Messages/messages.service.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";
import fs from "fs";
import {
  getOpenAIReply,
  isChatLocked,
  isMessageProcessed,
  lockChat,
  markMessageProcessed,
  sendWhatsAppMessage,
  sendTypingIndicator,
  sendReadReceipt,
  unlockChat,
  tryAcquireLock,
  queuePendingMessage,
  consumePendingMessage,
} from "./AuthWhatsapp.service.js";
import { APPOINTMENT_INTENTS, GREETING_KEYWORDS } from "../../utils/ai/intentClassifier.js"; // NEW
import { appointmentOrchestrator } from "../AppointmentModel/appointmentConversation.service.js"; // NEW
import { parseButtonReply, sendQuickReply, sendListMessage, sendAppointmentCard } from "./whatsappButtons.service.js"; // NEW

import { processBillingFromWebhook } from "../BillingModel/billing.service.js";
import {
  canUseAI,
  getSuspensionMessage,
  WALLET_STATUS,
} from "../../utils/billing/walletGuard.js";

import { getTenantByPhoneNumberIdService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { getIO } from "../../middlewares/socket/socket.js";
import {
  findTenantByIdService,
  getTenantSettingsService,
  updateTenantWebhookStatusService,
} from "../TenantModel/tenant.service.js";

import db from "../../database/index.js";
import {
  createContactService,
  getContactByPhoneAndTenantIdService,
  getOrCreateContactService,
  updateContactService,
} from "../ContactsModel/contacts.service.js";
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
import { tableNames } from "../../database/tableName.js";

const FIXED_MISSING_INFO_FALLBACK =
  "Our team will get back to you shortly. Please feel free to ask any other questions in the meantime ?";

const MISSING_INFO_TAGS = new Set([
  "MISSING_KNOWLEDGE",
  "MISSING_KNOWLEDGEBASE_HOOK",
  "MISSING_INFO",
]);

const MISSING_INFO_REPLY_PATTERN =
  /(i\s*do\s*not|i\s*don't|i\s*cannot|i\s*can't|unable\s+to|not\s+enough\s+information|outside\s+(my|our)\s+(scope|knowledge)|our team will get back to you shortly|let me check with the team)/i;

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
      : "Our team will review your message and contact you shortly.";

  // When MISSING_KNOWLEDGE is detected but the AI DID provide a real answer,
  // send the AI's actual reply (not the fallback). Only use the fallback
  // when the AI reply is empty/null (true missing info scenario).
  const messageToSend =
    finalReply && finalReply.trim()
      ? finalReply.trim()
      : fallback;

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
                mappedStatus === 'rejected' ? rejectionReason : null,
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
                JSON.stringify({ event: status, reason: rejectionReason || null }),
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

      await db.sequelize.transaction(async (t) => {
        const recipient = await db.WhatsappCampaignRecipients.findOne({
          where: { meta_message_id: messageId },
          include: [{ model: db.WhatsappCampaigns, as: "campaign" }],
          lock: t.LOCK.UPDATE,
          transaction: t,
        });

        if (recipient) {
          const oldStatus = recipient.status;
          const statusPriority = {
            sent: 1,
            delivered: 2,
            read: 3,
            replied: 4,
            failed: 5,
            permanently_failed: 6,
          };

          // Determine if this is a permanent failure from Meta error message
          let effectiveStatus = status;
          if (status === "failed") {
            const errorTitle = String(
              statusUpdate.errors?.[0]?.title || "",
            ).toLowerCase();
            const errorMessage = String(
              statusUpdate.errors?.[0]?.message || "",
            ).toLowerCase();
            const combinedError = errorTitle + " " + errorMessage;

            const isPermanentMetaError =
              combinedError.includes("healthy ecosystem") ||
              combinedError.includes("not delivered") ||
              combinedError.includes("spam") ||
              combinedError.includes("blocked") ||
              combinedError.includes("recipient not on whatsapp") ||
              combinedError.includes("incapable of receiving") ||
              combinedError.includes("re-engage") ||
              combinedError.includes("user is not in allowed list");

            if (isPermanentMetaError) {
              effectiveStatus = "permanently_failed";
            }
          }

          if (
            statusPriority[effectiveStatus] > (statusPriority[oldStatus] || 0)
          ) {
            const updateData = {
              status: effectiveStatus,
              error_message:
                effectiveStatus === "failed" ||
                  effectiveStatus === "permanently_failed"
                  ? statusUpdate.errors?.[0]?.title
                  : null,
            };

            // Mark as max retries if permanently failed
            if (effectiveStatus === "permanently_failed") {
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
      if (
        campaignUpdatePayload &&
        (campaignUpdatePayload.status === "failed" ||
          campaignUpdatePayload.status === "permanently_failed")
      ) {
        setImmediate(async () => {
          try {
            const campaign_id = campaignUpdatePayload.campaign_id;

            // Count remaining pending recipients
            const pendingCount = await db.WhatsappCampaignRecipients.count({
              where: { campaign_id, status: "pending", is_deleted: false },
            });

            // If no pending recipients, check final status
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

              const retryableFailedCount =
                await db.WhatsappCampaignRecipients.count({
                  where: {
                    campaign_id,
                    is_deleted: false,
                    status: "failed",
                    retry_count: { [db.Sequelize.Op.lt]: 3 },
                  },
                });

              // Only update if no retryable failures pending
              if (retryableFailedCount === 0) {
                const newStatus = successCount > 0 ? "completed" : "failed";
                await db.WhatsappCampaigns.update(
                  { status: newStatus },
                  { where: { campaign_id, status: "active" } },
                );
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

    // 4. Deduplication Check
    const ismessage = await isMessageProcessed(
      tenant_id,
      phone_number_id,
      messageId,
    );
    if (ismessage?.length > 0) return res.sendStatus(200);
    await markMessageProcessed(tenant_id, phone_number_id, messageId, phone);

    // 4.5 Send Read Receipt to Meta (Blue Tick only — typing indicator sent later if AI will respond)
    setImmediate(() => {
      sendReadReceipt(tenant_id, phone_number_id, messageId);
    });

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
        contact_id: contactsaved?.contact_id,
        phone_number_id,
        messageId,
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

        // AI will respond — send typing indicator now
        sendTypingIndicator(tenant_id, phone_number_id, phone, messageId);

        // NEW: Build a contact object that the appointment orchestrator expects
        const contactObj = { ...contactsaved, phone_number: phone }; // NEW
        const effectiveText = buttonReplyId || text; // NEW — use button ID when available

        // NEW: Audio / voice guard — appointments are text-only
        if (type === "audio") { // NEW
          await sendWhatsAppMessage( // NEW
            tenant_id, phone, // NEW
            "Sorry, I can only handle text messages for appointments. Please type your request.", // NEW
          ); // NEW
          return; // NEW
        } // NEW

        // NEW: Check if user is in a pending confirmation state (YES/NO for any booking flow)
        const confirmResult = await appointmentOrchestrator.handleConfirmation( // NEW
          effectiveText, contactObj, tenant_id, // NEW
        ); // NEW
        if (confirmResult) { // NEW
          await handleAppointmentResponse( // NEW
            confirmResult, tenant_id, phone, contactsaved, phone_number_id, name, // NEW
          ); // NEW
          return; // NEW
        } // NEW

        // NEW: Route button replies that map directly to appointment intents
        if (buttonReplyId) { // NEW
          let apptIntent = null; // NEW
          let resolvedMessage = effectiveText; // NEW — may be overridden for slot/doctor decoding

          if (APPOINTMENT_INTENTS.includes(buttonReplyId)) { // NEW
            apptIntent = buttonReplyId; // NEW — e.g. "create_appointment" tapped as button
          } else if (buttonReplyId.startsWith("reschedule_")) { // NEW
            // NEW: Pass the embedded appointment_id so the flow targets the right appointment
            apptIntent = "reschedule_appointment"; // NEW
            resolvedMessage = buttonReplyId; // NEW — orchestrator extracts apt_id from it
          } else if (buttonReplyId.startsWith("cancel_")) { // NEW
            apptIntent = "cancel_appointment"; // NEW
            resolvedMessage = buttonReplyId; // NEW — orchestrator extracts apt_id from it
          } else if (buttonReplyId.startsWith("slot_")) { // NEW
            // NEW: Decode encoded slot time back to "HH:MM AM" before passing to flow
            const encodedTime = buttonReplyId.slice("slot_".length); // NEW
            resolvedMessage = decodeSlotTime(encodedTime); // NEW — e.g. "09:00 AM"
            apptIntent = "APPOINTMENT_ACTION"; // NEW
          } else if (buttonReplyId.startsWith("doctor_")) { // NEW
            // NEW: Pass raw button ID — orchestrator detects "doctor_" prefix and looks up by ID
            apptIntent = "APPOINTMENT_ACTION"; // NEW
            resolvedMessage = buttonReplyId; // NEW
          } // NEW

          if (apptIntent) { // NEW
            const apptResult = await appointmentOrchestrator.handleAppointmentIntent( // NEW
              apptIntent, resolvedMessage, contactObj, tenant_id, // NEW
            ); // NEW
            await handleAppointmentResponse( // NEW
              apptResult, tenant_id, phone, contactsaved, phone_number_id, name, // NEW
            ); // NEW
            return; // NEW
          } // NEW
        } // NEW

        // If user is mid-booking (active session exists that is NOT in confirming/processing state),
        // force intent to APPOINTMENT_ACTION so the flow continues instead of being reclassified.
        const activeSession = await db.BookingSessions.findOne({
          where: {
            contact_id: contactsaved.contact_id,
            tenant_id,
            status: "active",
          },
          order: [["updatedAt", "DESC"]],
        });

        if (
          activeSession &&
          !["confirming", "processing", "completed", "cancelled"].includes(activeSession.current_step)
        ) {
          const apptResult = await appointmentOrchestrator.handleAppointmentIntent(
            "APPOINTMENT_ACTION",
            effectiveText,
            contactObj,
            tenant_id,
          );
          await handleAppointmentResponse(
            apptResult, tenant_id, phone, contactsaved, phone_number_id, name
          );
          return;
        }

        // NEW: Greeting detection — keyword-based, no AI cost
        const lowerTrimmed = effectiveText.toLowerCase().trim(); // NEW
        const wordCount = effectiveText.trim().split(/\s+/).length; // NEW
        const isGreeting = // NEW
          wordCount <= 3 && // NEW
          GREETING_KEYWORDS.some( // NEW
            (kw) => lowerTrimmed === kw || lowerTrimmed.startsWith(kw + " "), // NEW
          ); // NEW
        if (isGreeting) { // NEW
          await handleAppointmentResponse( // NEW
            { message: "Welcome! How can I help you today?", buttonType: "greeting_menu" }, // NEW
            tenant_id, phone, contactsaved, phone_number_id, name, // NEW
          ); // NEW
          return; // NEW
        } // NEW

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

        // Pass cached data to avoid redundant DB calls in AI flow
        const cachedData = {
          tenantSettings,
          contact: contactsaved,
          lead: leadSaved,
        };

        const aiResult = await getOpenAIReply(
          tenant_id,
          phone,
          text,
          contactsaved?.contact_id,
          phone_number_id,
          cachedData,
        );

        // Log AI result for debugging UPDATE/CANCEL issues
        console.log(`[WEBHOOK] AI Result:`, {
          tagDetected: aiResult?.tagDetected || "NONE",
          tagPayloadPreview: aiResult?.tagPayload?.substring(0, 150) || "N/A",
          messagePreview: aiResult?.message?.substring(0, 200) || "N/A",
        });

        // NEW: If getOpenAIReply routed an appointment intent, handle interactive response
        // handleAppointmentResponse saves to DB and emits socket internally
        if (aiResult?._apptResult) { // NEW
          await handleAppointmentResponse( // NEW
            aiResult._apptResult, tenant_id, phone, contactsaved, phone_number_id, name, // NEW
          ); // NEW
          return; // NEW
        } // NEW
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
        if (tagToExecute) {
          console.log(
            `[WEBHOOK] Executing tag handler: ${tagToExecute}, payload: ${String(tagPayloadToExecute || "").substring(0, 100)}`,
          );
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
        if (pending) {
          console.log(`[WEBHOOK] Processing queued message for ${phone}`);
          const reLock = await tryAcquireLock(
            tenant_id,
            phone_number_id,
            phone,
          );
          if (reLock) {
            setImmediate(async () => {
              try {
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

                const aiResult = await getOpenAIReply(
                  tenant_id,
                  phone,
                  pending.text,
                  pending.contact_id,
                  phone_number_id,
                );

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

                if (messageToSend) {
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
                      },
                      pending.text,
                    );
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
                } catch (_) { }
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

// NEW: Route an appointment orchestrator result to the correct WhatsApp message type.
// Also saves the bot message to the DB and emits to the dashboard socket.
async function handleAppointmentResponse( // NEW
  result, tenant_id, phone, // NEW
  contactsaved = null, phone_number_id = null, name = null, // NEW
) { // NEW
  if (!result) return; // NEW

  // Determine the plain-text version to save to the messages DB
  const textToSave = result.message || "Appointment action processed."; // NEW
  const isInteractive = Boolean(result.buttonType); // NEW
  let interactive_payload = null; // NEW
  if (isInteractive) { // NEW
    try { // NEW
      interactive_payload = JSON.stringify({ // NEW
        buttonType: result.buttonType, // NEW
        slots: result.slots || null, // NEW
        doctors: result.doctors || null, // NEW
        appointments: result.appointments || null, // NEW
        buttons: // NEW
          result.buttonType === "confirmation" || result.buttonType === "cancel_confirmation" // NEW
            ? [{ title: "Confirm" }, { title: "Cancel" }] // NEW
            : result.buttonType === "greeting_menu" // NEW
              ? [ // NEW
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
    } catch { // NEW
      interactive_payload = null; // NEW
    } // NEW
  } // NEW

  try { // NEW
    // ── Send the WhatsApp message (interactive or plain text) ─────────────
    if (result.buttonType === "confirmation" || result.buttonType === "cancel_confirmation") { // NEW
      await sendQuickReply(tenant_id, phone, result.message, [ // NEW
        { id: "confirm_yes", title: "Confirm" }, // NEW
        { id: "confirm_no", title: "Cancel" }, // NEW
      ]); // NEW
    } else if (result.buttonType === "slot_selection" && result.slots?.length) { // NEW
      const buttons = result.slots.slice(0, 3).map((s) => ({ // NEW
        // Store the raw time string in the ID so we can recover it on tap
        id: "slot_" + encodeSlotTime(s.time), // NEW
        title: s.time, // NEW
      })); // NEW
      await sendQuickReply(tenant_id, phone, result.message, buttons); // NEW
    } else if (result.buttonType === "doctor_list" && result.doctors?.length) { // NEW
      const rows = result.doctors.slice(0, 10).map((d) => ({ // NEW
        id: "doctor_" + d.id, // NEW
        title: "Dr. " + d.name, // NEW
        description: d.specialization || "", // NEW
      })); // NEW
      await sendListMessage( // NEW
        tenant_id, phone, // NEW
        "Please choose a doctor:", // NEW
        "View doctors", // NEW
        [{ title: "Available doctors", rows }], // NEW
      ); // NEW
    } else if (result.buttonType === "appointment_actions" && result.appointments?.length) { // NEW
      for (const apt of result.appointments) { // NEW
        await sendAppointmentCard(tenant_id, phone, apt); // NEW
      } // NEW
    } else if (result.buttonType === "greeting_menu") { // NEW
      await sendQuickReply(tenant_id, phone, result.message, [ // NEW
        { id: "create_appointment", title: "Book appointment" }, // NEW
        { id: "view_my_appointments", title: "My appointments" }, // NEW
        { id: "cancel_appointment", title: "Cancel / Reschedule" }, // NEW
      ]); // NEW
    } else if (result.buttonType === "book_prompt") { // NEW
      await sendQuickReply(tenant_id, phone, result.message, [ // NEW
        { id: "create_appointment", title: "Book appointment" }, // NEW
      ]); // NEW
    } else if (result.buttonType === "post_booking") { // NEW
      await sendQuickReply(tenant_id, phone, result.message, [ // NEW
        { id: "view_my_appointments", title: "My appointments" }, // NEW
        { id: "create_appointment", title: "Book another" }, // NEW
      ]); // NEW
    } else { // NEW
      await sendWhatsAppMessage(tenant_id, phone, result.message || "Done."); // NEW
    } // NEW
  } catch (err) { // NEW
    console.error("[APPT-RESPONSE] Failed to send appointment response:", err.message); // NEW
    await sendWhatsAppMessage(tenant_id, phone, result.message || "Done.").catch(() => { }); // NEW
  } // NEW

  // ── Persist bot message to DB + emit to dashboard socket ──────────────
  try { // NEW
    const contact_id = contactsaved?.contact_id || null; // NEW
    const messageTypeToSave = isInteractive ? "interactive" : "text"; // NEW
    const savedBotMsg = contact_id // NEW
      ? await createUserMessageService( // NEW
        tenant_id, contact_id, phone_number_id, // NEW
        phone, null, name, "bot", null, // NEW
        textToSave, messageTypeToSave, null, null, null, null, null, interactive_payload, // NEW
      ) // NEW
      : null; // NEW

    const io = getIO(); // NEW
    io.to(`tenant-${tenant_id}`).emit("ai-typing", { tenant_id, phone, status: false }); // NEW
    io.to(`tenant-${tenant_id}`).emit("new-message", { // NEW
      tenant_id, phone, // NEW
      id: savedBotMsg?.id || null, // NEW
      contact_id, phone_number_id, // NEW
      name: contactsaved?.name || name || null, // NEW
      message: textToSave, // NEW
      message_type: messageTypeToSave, interactive_payload, media_url: null, // NEW
      status: "sent", sender: "bot", // NEW
      created_at: new Date(), // NEW
    }); // NEW
  } catch (dbErr) { // NEW
    console.error("[APPT-RESPONSE] DB/socket persistence failed:", dbErr.message); // NEW
  } // NEW
} // NEW

// NEW: Encode a time string like "09:00 AM" → "09-00-AM" for use in button IDs
// Avoids colons and spaces which some parsers reject in IDs.
function encodeSlotTime(time) {
  // Pad single-digit hour: "9:00 AM" → "09:00 AM" first, then replace separators
  return String(time)
    .replace(/^(\d):/, "0$1:")   // "9:00 AM" → "09:00 AM"
    .replace(/:/g, "-")          // "09:00 AM" → "09-00 AM"
    .replace(/\s+/g, "-");       // "09-00 AM" → "09-00-AM"
}

// Reverse encodeSlotTime: "09-00-AM" → "09:00 AM"
function decodeSlotTime(encoded) {
  // Accepts both 1 and 2 digit hours for safety
  return String(encoded).replace(/^(\d{1,2})-(\d{2})-([AP]M)$/, (_, h, m, p) =>
    `${h.padStart(2, "0")}:${m} ${p}`,
  );
}
