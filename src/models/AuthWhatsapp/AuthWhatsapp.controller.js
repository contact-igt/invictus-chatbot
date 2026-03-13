import { sendTypingIndicator } from "../../utils/chat/sendTypingIndicator.js";
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
  unlockChat,
} from "./AuthWhatsapp.service.js";

import { getTenantByPhoneNumberIdService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { getIO } from "../../middlewares/socket/socket.js";
import {
  findTenantByIdService,
  updateTenantWebhookStatusService,
} from "../TenantModel/tenant.service.js";
import db from "../../database/index.js";
import {
  createContactService,
  getContactByPhoneAndTenantIdService,
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
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const statusUpdate = value?.statuses?.[0];

    // 1. Handle Status Updates (Sent/Delivered/Read)
    if (statusUpdate) {
      const messageId = statusUpdate.id;
      const status = statusUpdate.status;
      let campaignUpdatePayload = null;

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
        } catch (_) {}
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
                const io = getIO();
                io.to(`tenant-${msgRow.tenant_id}`).emit("message-status-update", {
                  message_id: msgRow.id,
                  phone: msgRow.phone,
                  contact_id: msgRow.contact_id,
                  status,
                });
              } catch (_) {}
            }
          }
        }
      } catch (statusErr) {
        console.error("[WEBHOOK] Error updating message status:", statusErr.message);
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

    if (type === "text") text = msg.text?.body || "";
    else if (type === "interactive") {
      const interactive = msg.interactive;
      if (interactive.type === "button_reply")
        text = interactive.button_reply.title;
      else if (interactive.type === "list_reply")
        text = interactive.list_reply.title;
      else text = "[Interactive Message]";
    } else if (type === "button") text = msg.button?.text || "[Button Click]";
    else if (type === "image") text = msg.image?.caption || "[Image]";
    else if (type === "video") text = msg.video?.caption || "[Video]";
    else if (type === "document")
      text =
        msg.document?.caption ||
        `[Document: ${msg.document?.filename || "file"}]`;
    else if (type === "audio") text = "[Audio]";
    else if (type === "location")
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

    // 5. Manage Contact and LiveChat
    let contactsaved = await getContactByPhoneAndTenantIdService(tenant_id, phone);
    if (!contactsaved) {
      await createContactService(tenant_id, phone, name ? name : null, null);
      contactsaved = await getContactByPhoneAndTenantIdService(
        tenant_id,
        phone,
      );
      io.to(`tenant-${tenant_id}`).emit("contact-created", {
        tenant_id,
        phone,
        name,
        contact_id: contactsaved?.contact_id,
      });
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
      type
    );

    // 7. Emit Real-time Event to Frontend
    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone,
      id: savedMsg?.id,
      contact_id: contactsaved?.contact_id,
      phone_number_id,
      name,
      message: text,
      sender: "user",
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

    // 10. AI Processing (Background)
    if (await isChatLocked(tenant_id, phone_number_id, phone)) {
      return res.sendStatus(200);
    }
    await lockChat(tenant_id, phone_number_id, phone);
    res.sendStatus(200); // Acknowledge Webhook

    setImmediate(async () => {
      try {
        await sendTypingIndicator(
          phone_number_id,
          account?.access_token,
          messageId,
        );

        const aiResult = await getOpenAIReply(
          tenant_id,
          phone,
          text,
          contactsaved?.contact_id,
          phone_number_id,
        );

        const finalReply = aiResult?.message;
        const fallback =
          "Our team will review your message and contact you shortly.";
        const messageToSend =
          finalReply && finalReply.trim() ? finalReply.trim() : fallback;

        io.to(`tenant-${tenant_id}`).emit("new-message", {
          tenant_id,
          phone,
          phone_number_id,
          name,
          message: messageToSend,
          sender: "bot",
          created_at: new Date(),
        });

        await createUserMessageService(
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

        await sendWhatsAppMessage(tenant_id, phone, messageToSend).catch(
          (err) =>
            console.error("[WHATSAPP-SEND] Failed to send reply:", err.message),
        );

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
      }
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
};
