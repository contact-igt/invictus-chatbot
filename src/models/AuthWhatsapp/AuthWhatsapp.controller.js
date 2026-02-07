import { sendTypingIndicator } from "../../utils/sendTypingIndicator.js";
import { createUserMessageService } from "../Messages/messages.service.js";
import { formatPhoneNumber } from "../../utils/formatPhoneNumber.js";
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
import db from "../../database/index.js";
import {
  createContactService,
  getContactByPhoneAndTenantIdService,
} from "../ContactsModel/contacts.service.js";
import {
  createLeadService,
  getLeadByContactIdService,
  updateLeadService,
} from "../LeadsModel/leads.service.js";
import {
  createLiveChatService,
  getLivechatByIdService,
  updateLiveChatTimestampService
} from "../LiveChatModel/livechat.service.js";

export const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

export const receiveMessage = async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    const statusUpdate = value?.statuses?.[0];

    if (statusUpdate) {
      const messageId = statusUpdate.id;
      const status = statusUpdate.status;

      await db.sequelize.transaction(async (t) => {
        const recipient = await db.WhatsappCampaignRecipients.findOne({
          where: { meta_message_id: messageId },
          include: [{ model: db.WhatsappCampaigns, as: "campaign" }],
          lock: t.LOCK.UPDATE,
          transaction: t
        });

        if (recipient) {
          const oldStatus = recipient.status;
          const statusPriority = { sent: 1, delivered: 2, read: 3, replied: 4, failed: 5 };

          if (statusPriority[status] > (statusPriority[oldStatus] || 0)) {
            await recipient.update({
              status: status,
              error_message: status === "failed" ? statusUpdate.errors?.[0]?.title : null
            }, { transaction: t });

            if (recipient.campaign) {
              if (status === "delivered" && oldStatus === "sent") {
                await recipient.campaign.increment("delivered_count", { transaction: t });
              } else if (status === "read") {
                if (oldStatus === "sent") {
                  await recipient.campaign.increment(["delivered_count", "read_count"], { transaction: t });
                } else if (oldStatus === "delivered") {
                  await recipient.campaign.increment("read_count", { transaction: t });
                }
              }
            }
          }
        }
      });

      return res.sendStatus(200);
    }

    if (!msg) return res.sendStatus(200);

    const phone_number_id = value?.metadata?.phone_number_id;
    if (!phone_number_id) return res.sendStatus(200);

    const account = await getTenantByPhoneNumberIdService(phone_number_id);
    if (!account) return res.sendStatus(200);

    const tenant_id = account.tenant_id;

    let phone = msg.from;
    phone = formatPhoneNumber(phone);

    const text = msg.text?.body || "";
    const messageId = msg.id;

    const name = value?.contacts?.[0]?.profile?.name || null;

    const ismessage = await isMessageProcessed(
      tenant_id,
      phone_number_id,
      messageId,
    );

    if (ismessage?.length > 0) {
      return res.sendStatus(200);
    }

    await markMessageProcessed(tenant_id, phone_number_id, messageId, phone);

    const io = getIO();

    io.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone,
      phone_number_id,
      name,
      message: text,
      sender: "user",
      created_at: new Date(),
    });

    let contactsaved = await getContactByPhoneAndTenantIdService(
      tenant_id,
      phone,
    );
    if (!contactsaved) {
      await createContactService(tenant_id, phone, name ? name : null, null);
      contactsaved = await getContactByPhoneAndTenantIdService(
        tenant_id,
        phone,
      );
    }

    const livelist = await getLivechatByIdService(tenant_id, contactsaved?.contact_id);

    if (!livelist) {
      await createLiveChatService(tenant_id, contactsaved?.contact_id);
    } else {
      await updateLiveChatTimestampService(tenant_id, contactsaved?.contact_id);
    }

    await createUserMessageService(
      tenant_id,
      contactsaved?.contact_id,
      phone_number_id,
      phone,
      messageId,
      name,
      "user",
      null,
      text,
    );


    const cleanPhone = phone.replace(/\D/g, "");
    const phoneSuffix = cleanPhone.slice(-10);

    const lastCampaignRecipient = await db.WhatsappCampaignRecipients.findOne({
      where: {
        mobile_number: { [db.Sequelize.Op.like]: `%${phoneSuffix}` }
      },
      order: [["created_at", "DESC"]],
      include: [{
        model: db.WhatsappCampaigns,
        as: "campaign",
        where: { tenant_id, is_deleted: false }, // Critical: Filter by current tenant
        required: true
      }]
    });

    if (lastCampaignRecipient) {
      const allowedStatuses = ["sent", "delivered", "read"];
      if (allowedStatuses.includes(lastCampaignRecipient.status) && lastCampaignRecipient.campaign) {
        const campaignSentAt = new Date(lastCampaignRecipient.updated_at).getTime();
        const nowTime = new Date().getTime();
        const hoursDiff = (nowTime - campaignSentAt) / (1000 * 60 * 60);

        if (hoursDiff <= 24) {
          await lastCampaignRecipient.update({ status: "replied" });
          await lastCampaignRecipient.campaign.increment("replied_count");
        }
      }
    }

    fs.appendFileSync("webhook_debug.log", `Contact found/created: ${JSON.stringify(contactsaved)}\n`);
    let leadSaved = await getLeadByContactIdService(tenant_id, contactsaved?.contact_id);
    fs.appendFileSync("webhook_debug.log", `Existing Lead: ${JSON.stringify(leadSaved)}\n`);

    if (!leadSaved) {
      fs.appendFileSync("webhook_debug.log", `Creating lead for contact: ${contactsaved?.contact_id}\n`);
      await createLeadService(tenant_id, contactsaved?.contact_id, "whatsapp");
      leadSaved = await getLeadByContactIdService(tenant_id, contactsaved?.contact_id);
      fs.appendFileSync("webhook_debug.log", `New Lead: ${JSON.stringify(leadSaved)}\n`);
    }

    await updateLeadService(tenant_id, leadSaved?.contact_id);

    if (await isChatLocked(tenant_id, phone_number_id, phone)) {
      return res.sendStatus(200);
    }

    await lockChat(tenant_id, phone_number_id, phone);

    res.sendStatus(200);

    setImmediate(async () => {
      try {
        await sendTypingIndicator(
          phone_number_id,
          account?.access_token,
          messageId,
        );

        let reply = await getOpenAIReply(tenant_id, phone, text);

        if (!reply || !reply.trim()) {
          const fallback =
            "Our team will review your message and contact you shortly.";

          io.to(`tenant-${tenant_id}`).emit("new-message", {
            tenant_id,
            phone,
            phone_number_id,
            name,
            message: fallback,
            sender: "bot",
            created_at: new Date(),
          });

          await createUserMessageService(
            tenant_id,
            contactsaved?.contact_id,
            phone_number_id,
            phone,
            null, // Bot messages should not use user messageId as wamid
            name,
            "bot",
            null,
            fallback,
          );

          await sendWhatsAppMessage(tenant_id, phone, fallback);
          return;
        }

        const safeReply = reply.trim();

        io.to(`tenant-${tenant_id}`).emit("new-message", {
          tenant_id,
          phone,
          phone_number_id,
          name,
          message: safeReply,
          sender: "bot",
          created_at: new Date(),
        });

        await createUserMessageService(
          tenant_id,
          contactsaved?.contact_id,
          phone_number_id,
          phone,
          null, // Bot messages should not use user messageId as wamid
          name,
          "bot",
          null,
          safeReply,
        );

        await sendWhatsAppMessage(tenant_id, phone, safeReply);
      } catch (err) {
        console.error("Background error:", err);
      } finally {
        await unlockChat(tenant_id, phone_number_id, phone);
      }
    });
  } catch (err) {
    console.error("Webhook error:", err);
    fs.appendFileSync("webhook_debug.log", `CRITICAL ERROR: ${err.message}\n${err.stack}\n`);
    return res.sendStatus(200);
  }
};
