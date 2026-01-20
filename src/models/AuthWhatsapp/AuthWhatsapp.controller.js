import { sendTypingIndicator } from "../../utils/sendTypingIndicator.js";
import { createUserMessageService } from "../Messages/messages.service.js";
import {
  getOpenAIReply,
  isChatLocked,
  isMessageProcessed,
  lockChat,
  markMessageProcessed,
  sendWhatsAppMessage,
  unlockChat,
} from "./AuthWhatsapp.service.js";

import {
  createChatStateService,
  getChatStateByPhoneService,
  updateChatStateHeatOnUserMessageService,
} from "../ChatStateModel/chatState.service.js";
import { getTenantByPhoneNumberIdService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { getIO } from "../../middlewares/socket/socket.js";

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

    if (!msg) return res.sendStatus(200);

    const phone_number_id = value?.metadata?.phone_number_id;
    if (!phone_number_id) return res.sendStatus(200);

    const account = await getTenantByPhoneNumberIdService(phone_number_id);
    if (!account) return res.sendStatus(200);

    const tenant_id = account.tenant_id;

    const phone = msg.from;
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

    await createUserMessageService(
      tenant_id,
      phone_number_id,
      phone,
      messageId,
      name,
      "user",
      null,
      text,
    );

    let state = await getChatStateByPhoneService(
      tenant_id,
      phone_number_id,
      phone,
    );

    if (!state) {
      await createChatStateService(tenant_id, phone_number_id, phone, name);
      state = await getChatStateByPhoneService(
        tenant_id,
        phone_number_id,
        phone,
      );
    }

    await updateChatStateHeatOnUserMessageService(
      tenant_id,
      phone_number_id,
      phone,
    );

    if (state.state === "need_admin" || state.state === "admin_active") {
      return res.sendStatus(200);
    }

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
            phone_number_id,
            phone,
            messageId,
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
          phone_number_id,
          phone,
          messageId,
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
    return res.sendStatus(200);
  }
};
