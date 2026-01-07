import axios from "axios";
import OpenAI from "openai";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageStyle } from "../../utils/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/buildChatHistory.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";
import { tableNames } from "../../database/tableName.js";
import { sendTypingIndicator } from "../../utils/sendTypingIndicator.js";
import { createUserMessageService } from "../Messages/messages.service.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const sendWhatsAppMessage = async (to, message, replyToMessageId) => {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: message },
  };

  // 🔥 Reply to specific message
  if (replyToMessageId) {
    payload.context = {
      message_id: replyToMessageId,
    };
  }

  await axios.post(
    `https://graph.facebook.com/${process.env.META_API_VERSION}/${process.env.META_PHONE_NUMBER_ID}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
};

export const getOpenAIReply = async (phone, userMessage) => {
  try {
    if (!userMessage || !userMessage.trim()) {
      return "Hello. How can I help you?";
    }

    const DEFAULT_SYSTEM_PROMPT = `You are a WhatsApp support assistant.Reply briefly.Use the same language and typing style as the user.Be polite, calm, and helpful.If the required information is not available, say so politely.`;

    const style = detectLanguageStyle(userMessage);

    const memory = await getConversationMemory(phone, 4);

    const chatHistory = buildChatHistory(memory);

    const activePromptText = await getActivePromptService();

    const basePrompt =
      activePromptText && activePromptText.trim().length
        ? activePromptText
        : DEFAULT_SYSTEM_PROMPT;

    const chunks = await searchKnowledgeChunks(userMessage);
    const context =
      chunks && chunks.length
        ? chunks.join("\n\n")
        : "No relevant knowledge available.";

    const systemPrompt = `
    ${basePrompt}

    UPLOADED KNOWLEDGE:
    ${context} `;

    const response = await openai.chat.completions.create({
      // model: "gpt-4o-mini",
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: userMessage },
      ],
      temperature: 0.05,
      max_completion_tokens: 120,
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return "Please try again later.";
  }
};

export const isMessageProcessed = async (messageId) => {
  const [rows] = await db.sequelize.query(
    `SELECT message_id FROM ${tableNames?.PROCESSEDMESSAGE} WHERE message_id = ?`,
    { replacements: [messageId] }
  );
  return rows.length > 0;
};

export const markMessageProcessed = async (messageId, phone) => {
  await db.sequelize.query(
    `INSERT IGNORE INTO ${tableNames?.PROCESSEDMESSAGE} (message_id, phone) VALUES (?, ?)`,
    { replacements: [messageId, phone] }
  );
};

export const isChatLocked = async (phone) => {
  const [rows] = await db.sequelize.query(
    `SELECT phone FROM ${tableNames?.CHATLOCKS}
     WHERE phone = ?
     AND locked_at > NOW() - INTERVAL 10 SECOND`,
    { replacements: [phone] }
  );
  return rows.length > 0;
};

export const lockChat = async (phone) => {
  await db.sequelize.query(
    `INSERT INTO ${tableNames?.CHATLOCKS} (phone, locked_at)
     VALUES (?, NOW())
     ON DUPLICATE KEY UPDATE locked_at = NOW()`,
    { replacements: [phone] }
  );
};

export const unlockChat = async (phone) => {
  await db.sequelize.query(
    `DELETE FROM ${tableNames?.CHATLOCKS} WHERE phone = ?`,
    {
      replacements: [phone],
    }
  );
};

// export const processAIReplyInBackground = async (
//   phone,
//   name,
//   text,
//   messageId
// ) => {
//   try {
//     await sendTypingIndicator(messageId);

//     const reply = await getOpenAIReply(phone, text);
//     if (!reply) return;

//     await createUserMessageService(null, phone, name, "bot", null, reply);

//     await sendWhatsAppMessage(phone, reply, messageId);
//   } catch (err) {
//     console.error("Background AI error:", err.message);
//   }
// };
