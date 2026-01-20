import axios from "axios";
import https from "https";
import OpenAI from "openai";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageAI } from "../../utils/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/buildChatHistory.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
});

export const sendWhatsAppMessage = async (tenant_id, to, message) => {
  if (!message || !message.trim()) return;

  const [rows] = await db.sequelize.query(
    `
    SELECT phone_number_id, access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND status = 'active'
    LIMIT 1
    `,
    { replacements: [tenant_id] },
  );

  if (!rows.length) {
    throw new Error("No active WhatsApp account for tenant");
  }

  const { phone_number_id, access_token } = rows[0];

  await axios.post(
    `https://graph.facebook.com/v19.0/${phone_number_id}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message.trim() },
    },
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      httpsAgent,
      timeout: 30000,
    },
  );
};

export const sendTypingIndicator = async (tenant_id, phone_number_id, to) => {
  const [rows] = await db.sequelize.query(
    `
    SELECT access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND status = 'active'
    LIMIT 1
    `,
    { replacements: [tenant_id, phone_number_id] },
  );

  if (!rows.length) return;

  await axios.post(
    `https://graph.facebook.com/v19.0/${phone_number_id}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "typing",
    },
    {
      headers: {
        Authorization: `Bearer ${rows[0].access_token}`,
        "Content-Type": "application/json",
      },
    },
  );
};

export const isMessageProcessed = async (
  tenant_id,
  phone_number_id,
  message_id,
) => {
  try {
    const Query = `SELECT * FROM ${tableNames?.PROCESSEDMESSAGE} WHERE tenant_id = ? AND phone_number_id = ? AND message_id = ?`;

    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, phone_number_id, message_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const markMessageProcessed = async (
  tenant_id,
  phone_number_id,
  message_id,
  phone,
) => {
  try {
    const [result] = await db.sequelize.query(
      `INSERT IGNORE INTO ${tableNames.PROCESSEDMESSAGE}
     (tenant_id, phone_number_id, message_id, phone)
     VALUES (?, ?, ? , ?)`,
      { replacements: [tenant_id, phone_number_id, message_id, phone] },
    );
    return result;
  } catch (err) {
    throw err;
  }
};

export const isChatLocked = async (tenant_id, phone_number_id, phone) => {
  const [rows] = await db.sequelize.query(
    `
    SELECT 1
    FROM ${tableNames.CHATLOCKS}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND phone = ?
      AND created_at > (NOW() - INTERVAL 15 SECOND)
    LIMIT 1
    `,
    { replacements: [tenant_id, phone_number_id, phone] },
  );

  return rows.length > 0;
};

export const lockChat = async (tenant_id, phone_number_id, phone) => {
  await db.sequelize.query(
    `
    INSERT IGNORE INTO ${tableNames.CHATLOCKS}
    (tenant_id, phone_number_id, phone)
    VALUES (?,?,?)
    `,
    { replacements: [tenant_id, phone_number_id, phone] },
  );
};

export const unlockChat = async (tenant_id, phone_number_id, phone) => {
  await db.sequelize.query(
    `
    DELETE FROM ${tableNames.CHATLOCKS}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND phone = ?
    `,
    { replacements: [tenant_id, phone_number_id, phone] },
  );
};

export const getOpenAIReply = async (tenant_id, phone, userMessage) => {
  try {
    if (!userMessage) return null;

    const cleanMessage = userMessage.trim();
    if (!cleanMessage) return null;

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
    );

    const currentDateFormatted = now.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const currentDayFormatted = now.toLocaleDateString("en-US", {
      weekday: "long",
    });

    const currentTimeFormatted = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const languageInfo = await detectLanguageAI(cleanMessage);

    console.log("language", languageInfo);

    const memory = await getConversationMemory(tenant_id, phone);
    const chatHistory = buildChatHistory(memory);

    const hospitalPrompt =
      (await getActivePromptService(tenant_id)) ||
      "You are a hospital front-desk assistant.";

    const chunks = await searchKnowledgeChunks(tenant_id, cleanMessage);
    const knowledgeContext =
      chunks && chunks.length > 0
        ? chunks.join("\n\n")
        : "No relevant knowledge available.";

    const COMMON_BASE_PROMPT = `
You are a WhatsApp front-desk reception assistant.

GLOBAL RULES:
- Always read full conversation history before replying.
- Never repeat questions already asked.
- Be polite, calm, respectful, and human.
- Use simple words.
- Do NOT diagnose or prescribe medicines.
- Do NOT hallucinate.
`;


const systemPrompt = `
${COMMON_BASE_PROMPT}

${hospitalPrompt}

LANGUAGE ENFORCEMENT (STRICT):
- Detected language: ${languageInfo.language}
- Writing style: ${languageInfo.style}
- Label: ${languageInfo.label}
you must analyze the  Detected language AND Writing style then replay with correct sentence with meaning full of Lable way
Do NOT translate.
Do NOT change script.

KNOWLEDGE RULE (VERY STRICT):
- Answer ONLY using the information from UPLOADED KNOWLEDGE.
- If information is not available, clearly say so.
- Do NOT guess or add outside information.

APPOINTMENT / CALLBACK RULE:
- Do NOT confirm appointments.
- Offer CALLBACK by hospital team if user agrees.
- Collect details only after consent.

CURRENT DATE & TIME (IST):
Date: ${currentDateFormatted}
Day: ${currentDayFormatted}
Time: ${currentTimeFormatted}

UPLOADED KNOWLEDGE:
${knowledgeContext}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: cleanMessage },
      ],
    });

    const reply = response?.choices?.[0]?.message?.content?.trim();
    return reply || null;
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return null;
  }
};
