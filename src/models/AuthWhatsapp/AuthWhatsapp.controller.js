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

// export const receiveMessage = async (req, res) => {
//   try {
//     const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
//     if (!msg) return res.sendStatus(200);

//     const name =
//       req.body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ||
//       null;

//     const phone = msg.from;
//     const text = msg.text?.body || "";
//     const messageId = msg.id;

//     // 1️⃣ Save USER message
//     await createUserMessageService(messageId, phone, name, "user", null, text);

//     // 2️⃣ Get chat state
//     let state = await getChatStateByPhoneService(phone);

//     // 3️⃣ If new user → create chat state
//     if (!state || state.length === 0) {
//       await createChatStateService(name, phone);

//       // fetch again after create
//       state = await getChatStateByPhoneService(phone);
//     }

//     const chatState = state[0];

//     // 4️⃣ STATE HANDLING (MOST IMPORTANT)

//     // 🔴 Case 1: Waiting for admin → DO NOTHING
//     if (chatState.state === "need_admin") {
//       return res.sendStatus(200);
//     }

//     // 🔴 Case 2: Admin is chatting → DO NOTHING
//     if (chatState.state === "admin_active") {
//       return res.sendStatus(200);
//     }

//     // 🟢 Case 3: AI is active
//     if (chatState.state === "ai_active" && chatState.ai_enable === "true") {
//       await sendTypingIndicator(messageId);

//       const reply = await getOpenAIReply(phone, text);

//       // 🧠 OPTIONAL: if AI fails, switch to need_admin
//       if (!reply || reply === "I don't know") {
//         await updateChatStateToNeedAdminService(phone);
//         return res.sendStatus(200);
//       }

//       await createUserMessageService(null, phone, name, "bot", null, reply);

//       await sendWhatsAppMessage(phone, reply, messageId);
//     }
//   } catch (err) {
//     console.error("Webhook error:", err.message);
//   }

//   res.sendStatus(200);
// };

// const isDetailsRequired = await getAppSettingByKeyService(
//   "collect_details"
// );

// let reply

// if (isDetailsRequired === "true") {
//   reply = await processConversationService(phone, text);
// } else {
//   reply = await getOpenAIReply(phone, text);
// }

// export const receiveMessage = async (req, res) => {
//   try {
//     const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
//     if (!msg) return res.sendStatus(200);

//     const name =
//       req.body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ||
//       null;

//     const phone = msg.from;
//     const text = msg.text?.body || "";
//     const messageId = msg.id;

//     // 1️⃣ Save USER message
//     await createUserMessageService(messageId, phone, name, "user", null, text);

//     await sendTypingIndicator(messageId);

//     const reply = await getOpenAIReply(phone, text);

//     await createUserMessageService(null, phone, name, "bot", null, reply);

//     await sendWhatsAppMessage(phone, reply, messageId);

//   res.sendStatus(200);

//   }

//   catch (err) {
//     console.error("Webhook error:", err.message);
//   }

// };

export const receiveMessage = async (req, res) => {
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const name =
      req.body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ||
      null;

    const phone = msg.from;
    const text = msg.text?.body || "";
    const messageId = msg.id;

    /* =================================================
       1️⃣ SAVE USER MESSAGE (ALWAYS)
    ================================================= */
    await createUserMessageService(messageId, phone, name, "user", null, text);

    /* =================================================
       2️⃣ GET / CREATE CHAT STATE
    ================================================= */
    let state = await getChatStateByPhoneService(phone);

    if (!state || state.length === 0) {
      await createChatStateService(name, phone);
      state = await getChatStateByPhoneService(phone);
    }

    const chatState = state[0];

    /* =================================================
       3️⃣ HARD STOP STATES (NO AI)
    ================================================= */
    if (
      chatState.state === "need_admin" ||
      chatState.state === "admin_active"
    ) {
      return res.sendStatus(200);
    }

    /* =================================================
       4️⃣ CHAT LOCK (PREVENT DOUBLE / FAST REPLY)
    ================================================= */
    if (await isChatLocked(phone)) {
      return res.sendStatus(200);
    }

    await lockChat(phone);

    /* =================================================
       5️⃣ ACK WHATSAPP IMMEDIATELY (NO DELAY)
    ================================================= */
    res.sendStatus(200);

    /* =================================================
       6️⃣ BACKGROUND PROCESSING (AI + STATE)
    ================================================= */
    (async () => {
      try {
        // typing indicator
        await sendTypingIndicator(messageId);

        let reply;

        /* ---------------------------------------------
           DETAILS COLLECTION OR NORMAL AI
        --------------------------------------------- */
        const isDetailsRequired = await getAppSettingByKeyService(
          "collect_details"
        );

        if (isDetailsRequired === "true") {
          reply = await processConversationService(phone, text);
        } else {
          reply = await getOpenAIReply(phone, text);
        }

        /* ---------------------------------------------
           AI FAIL → MOVE TO ADMIN
        --------------------------------------------- */
        if (!reply || reply === "I don't know") {
          await updateChatStateToNeedAdminService(phone);
          return;
        }

        /* ---------------------------------------------
           SAVE + SEND BOT MESSAGE
        --------------------------------------------- */
        await createUserMessageService(null, phone, name, "bot", null, reply);

        await sendWhatsAppMessage(phone, reply, messageId);
      } catch (err) {
        console.error("Background AI error:", err.message);
      } finally {
        /* ---------------------------------------------
           🔓 ALWAYS UNLOCK CHAT
        --------------------------------------------- */
        await unlockChat(phone);
      }
    })();
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.sendStatus(200);
  }
};
