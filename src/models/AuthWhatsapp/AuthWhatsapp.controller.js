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
      const templateId = value.message_template_id;
      const status = value.event; // e.g., "APPROVED", "REJECTED"
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
        // Update template status in DB
        const [[template]] = await db.sequelize.query(
          `SELECT template_id, media_asset_id FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE meta_template_id = ? OR template_name = ? LIMIT 1`,
          { replacements: [templateId, templateName] },
        );

        if (template) {
          await db.sequelize.query(
            `UPDATE ${tableNames.WHATSAPP_TEMPLATE} SET status = ? WHERE template_id = ?`,
            { replacements: [mappedStatus, template.template_id] },
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
          };

          if (statusPriority[status] > (statusPriority[oldStatus] || 0)) {
            await recipient.update(
              {
                status: status,
                error_message:
                  status === "failed" ? statusUpdate.errors?.[0]?.title : null,
              },
              { transaction: t },
            );

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
                status,
              };
            }
          }
        }
      });
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
        const allowedMsgStatuses = ["sent", "delivered", "read"];
        if (allowedMsgStatuses.includes(status)) {
          const [msgRows] = await db.sequelize.query(
            `SELECT id, tenant_id, contact_id, phone, status FROM messages WHERE wamid = ? LIMIT 1`,
            { replacements: [messageId] },
          );
          if (msgRows.length > 0) {
            const msgRow = msgRows[0];
            const statusPriority = { sent: 1, delivered: 2, read: 3 };
            const currentPriority = statusPriority[msgRow.status] || 0;
            if (statusPriority[status] > currentPriority) {
              await db.sequelize.query(
                `UPDATE messages SET status = ? WHERE id = ?`,
                { replacements: [status, msgRow.id] },
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
    await updateLeadService(tenant_id, leadSaved?.contact_id);
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

        const finalReply = aiResult?.message;
        const fallback = aiResult?.tagDetected
          ? ""
          : "Our team will review your message and contact you shortly.";
        const messageToSend =
          finalReply && finalReply.trim() ? finalReply.trim() : fallback;

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
          null,
          name,
          "bot",
          null,
          messageToSend,
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

        // Update bot message with WAMID for status tracking
        if (botMsgResponse?.wamid && savedBotMsg?.id) {
          try {
            await db.sequelize.query(
              `UPDATE messages SET wamid = ?, status = 'sent' WHERE id = ?`,
              { replacements: [botMsgResponse.wamid, savedBotMsg.id] },
            );
            console.log(
              `[WEBHOOK] Bot message ${savedBotMsg.id} updated with wamid: ${botMsgResponse.wamid}`,
            );
          } catch (updateErr) {
            console.error(
              "[WEBHOOK] Failed to update bot message wamid:",
              updateErr.message,
            );
          }
        }

        // Execute tag handler AFTER sending the AI reply
        // This ensures correct message ordering (e.g., "Let me check..." before slots list)
        if (aiResult?.tagDetected) {
          console.log(
            `[WEBHOOK] Executing tag handler: ${aiResult.tagDetected}, payload: ${aiResult.tagPayload?.substring(0, 100)}`,
          );
          const { executeTagHandler } =
            await import("../../utils/ai/aiTagHandlers/index.js");
          await executeTagHandler(
            aiResult.tagDetected,
            aiResult.tagPayload,
            {
              tenant_id,
              contact_id: contactsaved?.contact_id,
              phone,
              phone_number_id,
            },
            messageToSend,
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

                console.log("AI started for:", phone);

                const finalReply = aiResult?.message;
                const fallback = aiResult?.tagDetected
                  ? ""
                  : "Our team will review your message and contact you shortly.";
                const messageToSend =
                  finalReply && finalReply.trim()
                    ? finalReply.trim()
                    : fallback;

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
                    null,
                    pending.contactsaved?.name || "Bot",
                    "bot",
                    null,
                    messageToSend,
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

                  if (botMsgResponse?.wamid && savedBotMsg?.id) {
                    try {
                      await db.sequelize.query(
                        `UPDATE messages SET wamid = ?, status = 'sent' WHERE id = ?`,
                        {
                          replacements: [botMsgResponse.wamid, savedBotMsg.id],
                        },
                      );
                    } catch (_) {}
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
