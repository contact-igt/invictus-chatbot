import { sendTypingIndicator } from "../../utils/sendTypingIndicator.js";
import { createUserMessageService } from "../Messages/messages.service.js";
import { getOpenAIReply, sendWhatsAppMessage } from "./AuthWhatsapp.service.js";
import { getAppSettingByKeyService } from "../AppSettings/appsetting.service.js";
import { processConversationService } from "../Conversation/conversation.service.js";

export const verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  try {
    if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
      console.log("✅ WEBHOOK VERIFIED BY META");
      return res.status(200).send(challenge); // MUST BE PLAIN TEXT
    }
    return res.status(203).send({
      message: "Webhook connection error",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const receiveMessage = async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const phone = msg.from;
    const text = msg.text?.body || "";
    const messageId = msg.id; // 🔥 VERY IMPORTANT

    // 1️⃣ Save user message
    await createUserMessageService(messageId, phone, "user", text);

    // 2️⃣ Mark read + show typing indicator (OFFICIAL)
    await sendTypingIndicator(messageId);

    // 3️⃣ Get AI reply (this takes time)

    const isDetailsRequired = await getAppSettingByKeyService(
      "contact_details"
    );

    let reply;

    if (isDetailsRequired === "true") {
      reply = await processConversationService(phone, text);
    } else {
      reply = await getOpenAIReply(phone, text);
    }

    // 4️⃣ Save bot reply
    await createUserMessageService(null, phone, "bot", reply);

    // 5️⃣ Send reply
    await sendWhatsAppMessage(phone, reply, messageId);
  } catch (err) {
    console.error("Webhook error:", err.message);
  }

  res.sendStatus(200);
};
