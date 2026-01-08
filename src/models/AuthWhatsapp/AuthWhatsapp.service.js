import axios from "axios";
import OpenAI from "openai";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageStyle } from "../../utils/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/buildChatHistory.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const sendWhatsAppMessage = async (to, message, replyToMessageId) => {
  if (!message || typeof message !== "string" || message.trim() === "") {
    return;
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: message.trim() },
  };

  if (replyToMessageId) {
    payload.context = { message_id: replyToMessageId };
  }

  await axios.post(
    `https://graph.facebook.com/${process.env.META_API_VERSION}/${process.env.META_PHONE_NUMBER_ID}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );
};

export const getOpenAIReply = async (phone, userMessage) => {
  try {
    if (!userMessage || typeof userMessage !== "string") {
      return null;
    }

    const cleanMessage = userMessage.trim();
    if (cleanMessage.length === 0) {
      return null;
    }

    const DEFAULT_SYSTEM_PROMPT = `
You are a WhatsApp support assistant.

Rules:
- Reply in the SAME language as the user.
- Be polite, calm, and professional.
- Answer clearly and completely.
- Use simple words.
- If the information is not available, say so honestly.
- Do NOT hallucinate.
`;

    detectLanguageStyle(cleanMessage);

    const memory = await getConversationMemory(phone, 4);
    const chatHistory = buildChatHistory(memory);

    const activePromptText = await getActivePromptService();

    const basePrompt =
      activePromptText && activePromptText.trim().length > 0
        ? activePromptText
        : DEFAULT_SYSTEM_PROMPT;

    const chunks = await searchKnowledgeChunks(cleanMessage);

    const knowledgeContext =
      chunks && chunks.length > 0
        ? chunks.join("\n\n")
        : "No relevant knowledge available.";

    /* 6️⃣ FINAL SYSTEM PROMPT */
    const systemPrompt = `
${basePrompt}

IMPORTANT:
- Answer ONLY using the information from UPLOADED KNOWLEDGE.
- If the answer is not found there, say you do not have that information.

UPLOADED KNOWLEDGE:
${knowledgeContext}
`;

    /* 7️⃣ OPENAI CALL */
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: cleanMessage },
      ],
      temperature: 0.05,
      max_completion_tokens: 180
    });

    /* 8️⃣ SAFE RESPONSE EXTRACTION */
    const reply = response?.choices?.[0]?.message?.content;

    if (!reply || typeof reply !== "string") {
      return null;
    }

    const finalReply = reply.trim();
    if (finalReply.length === 0) {
      return null;
    }

    return finalReply;
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return null; // 🔥 controller handles fallback/admin
  }
};


export const isMessageProcessed = async (messageId) => {
  const [rows] = await db.sequelize.query(
    `SELECT message_id
     FROM ${tableNames.PROCESSEDMESSAGE}
     WHERE message_id = ?`,
    { replacements: [messageId] }
  );
  return rows.length > 0;
};

export const markMessageProcessed = async (messageId, phone) => {
  await db.sequelize.query(
    `INSERT IGNORE INTO ${tableNames.PROCESSEDMESSAGE}
     (message_id, phone)
     VALUES (?, ?)`,
    { replacements: [messageId, phone] }
  );
};

/* =========================
   CHAT LOCK (AUTO EXPIRE)
========================= */
export const isChatLocked = async (phone) => {
  const [rows] = await db.sequelize.query(
    `
    SELECT phone
    FROM ${tableNames.CHATLOCKS}
    WHERE phone = ?
      AND created_at > (NOW() - INTERVAL 15 SECOND)
    `,
    { replacements: [phone] }
  );
  return rows.length > 0;
};

export const lockChat = async (phone) => {
  await db.sequelize.query(
    `
    INSERT IGNORE INTO ${tableNames.CHATLOCKS}
    (phone, created_at)
    VALUES (?, NOW())
    `,
    { replacements: [phone] }
  );
};

export const unlockChat = async (phone) => {
  await db.sequelize.query(
    `DELETE FROM ${tableNames.CHATLOCKS} WHERE phone = ?`,
    { replacements: [phone] }
  );
};
