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
import { getAppSettingByKeyService } from "../AppSettings/appsetting.service.js";
import { processConversationService } from "../Conversation/conversation.service.js";
import {
  createChatStateService,
  getChatStateByPhoneService,
  updateChatStateToNeedAdminService,
} from "../ChatStateModel/chatState.service.js";

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
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const phone = msg.from;
    const text = msg.text?.body || "";
    const messageId = msg.id;

    const name =
      req.body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ||
      null;

    if (await isMessageProcessed(messageId)) {
      return res.sendStatus(200);
    }
    await markMessageProcessed(messageId, phone);

    await createUserMessageService(messageId, phone, name, "user", null, text);

    let state = await getChatStateByPhoneService(phone);

    if (!state || state.length === 0) {
      await createChatStateService(name, phone);
      state = await getChatStateByPhoneService(phone);
    }

    const chatState = state[0];

    if (
      chatState.state === "need_admin" ||
      chatState.state === "admin_active"
    ) {
      return res.sendStatus(200);
    }

    if (await isChatLocked(phone)) {
      return res.sendStatus(200);
    }
    await lockChat(phone);

    res.sendStatus(200);

    setImmediate(async () => {
      try {
        console.log("🚀 Background process started for", phone);

        try {
          await sendTypingIndicator(messageId);
          console.log("✍️ Typing indicator sent");
        } catch (e) {
          console.warn("⚠️ Typing indicator failed:", e.message);
        }

        // try {
        //   await sendWhatsAppMessage(
        //     phone,
        //     "Please wait a moment. I am checking this for you.",
        //     messageId
        //   );
        //   console.log("💬 Wait message sent");
        // } catch (e) {
        //   console.warn("⚠️ Wait message failed:", e.message);
        // }

        // 3️⃣ AI MUST ALWAYS RUN
        console.log("🤖 Calling AI...");
        let reply;
        const isDetailsRequired = await getAppSettingByKeyService(
          "collect_details"
        );

        if (isDetailsRequired === "true") {
          reply = await processConversationService(phone, text);
        } else {
          reply = await getOpenAIReply(phone, text);
        }

        console.log("✅ AI response:", reply);

        // 4️⃣ Validation
        if (!reply || typeof reply !== "string" || reply.trim() === "") {
          console.warn("❗ Empty AI reply, switching to admin");

          await updateChatStateToNeedAdminService(phone);

          const fallback =
            "Our team will review your message and contact you shortly.";

          await createUserMessageService(
            null,
            phone,
            name,
            "bot",
            null,
            fallback
          );

          await sendWhatsAppMessage(phone, fallback, messageId);
          return;
        }

        const safeReply = reply.trim();

        // 5️⃣ Save + Send final reply
        await createUserMessageService(
          null,
          phone,
          name,
          "bot",
          null,
          safeReply
        );

        await sendWhatsAppMessage(phone, safeReply, messageId);

        console.log("📤 Final reply sent");
      } catch (err) {
        console.error("🔥 Background fatal error:", err);
      } finally {
        await unlockChat(phone);
        console.log("🔓 Chat unlocked for", phone);
      }
    });
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(200);
  }
};
