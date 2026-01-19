import axios from "axios";
import https from "https";
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

const httpsAgent = new https.Agent({
  family: 4, // force IPv4 (fixes ENETUNREACH)
  keepAlive: true,
});

// export const sendWhatsAppMessage = async (to, message, replyToMessageId) => {
//   if (!message || typeof message !== "string" || message.trim() === "") {
//     return;
//   }

//   const payload = {
//     messaging_product: "whatsapp",
//     recipient_type: "individual",
//     to,
//     type: "text",
//     text: { body: message.trim() },
//   };

//   if (replyToMessageId) {
//     payload.context = { message_id: replyToMessageId };
//   }

//   await axios.post(
//     `https://graph.facebook.com/${process.env.META_API_VERSION}/${process.env.META_PHONE_NUMBER_ID}/messages`,
//     payload,
//     {
//       headers: {
//         Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
//         "Content-Type": "application/json",
//       },
//       timeout: 15000,
//     }
//   );
// };

// export const sendWhatsAppMessage = async (to, message, replyToMessageId) => {
//   try {
//     if (!message || typeof message !== "string" || message.trim() === "") {
//       return;
//     }

//     const payload = {
//       messaging_product: "whatsapp",
//       recipient_type: "individual",
//       to,
//       type: "text",
//       text: {
//         body: message.trim(),
//       },
//     };

//     if (replyToMessageId) {
//       payload.context = { message_id: replyToMessageId };
//     }

//     const url = `https://graph.facebook.com/${process.env.META_API_VERSION}/${process.env.META_PHONE_NUMBER_ID}/messages`;

//     await axios.post(url, payload, {
//       headers: {
//         Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
//         "Content-Type": "application/json",
//       },
//       httpsAgent,
//       timeout: 30000,
//     });
//   } catch (err) {
//     console.error("WhatsApp send failed:", err.message);
//   }
// };

// export const getOpenAIReply = async (phone, userMessage) => {
//   const now = new Date(
//     new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
//   );

//   const day = String(now.getDate()).padStart(2, "0");
//   const month = now.toLocaleString("en-US", { month: "long" });
//   const year = now.getFullYear();
//   const weekday = now.toLocaleString("en-US", { weekday: "long" });

//   let hours = now.getHours();
//   const minutes = String(now.getMinutes()).padStart(2, "0");
//   const ampm = hours >= 12 ? "PM" : "AM";
//   hours = hours % 12 || 12;

//   const currentDateFormatted = `${day} ${month} ${year}`;
//   const currentTimeFormatted = `${String(hours).padStart(
//     2,
//     "0"
//   )} ${minutes} ${ampm}`;
//   const currentDayFormatted = weekday;

//   console.log(
//     "Date/Time",
//     currentDateFormatted,
//     currentTimeFormatted,
//     currentDayFormatted
//   );

//   try {
//     if (!userMessage || typeof userMessage !== "string") {
//       return null;
//     }

//     const cleanMessage = userMessage.trim();
//     if (cleanMessage.length === 0) {
//       return null;
//     }

//     const DEFAULT_SYSTEM_PROMPT = `
//       You are a WhatsApp support assistant.

//      Rules:
//      - Reply in the SAME language as the user.
//      - Be polite, calm, and professional.
//      - Answer clearly and completely.
//      - Use simple words.
//      - If the information is not available, say so honestly.
//      - Do NOT hallucinate.
//       `;

//     detectLanguageStyle(cleanMessage);

//     const memory = await getConversationMemory(phone, 4);
//     const chatHistory = buildChatHistory(memory);

//     const activePromptText = await getActivePromptService();

//     const basePrompt =
//       activePromptText && activePromptText.trim().length > 0
//         ? activePromptText
//         : DEFAULT_SYSTEM_PROMPT;

//     const chunks = await searchKnowledgeChunks(cleanMessage);

//     const knowledgeContext =
//       chunks && chunks.length > 0
//         ? chunks.join("\n\n")
//         : "No relevant knowledge available.";

//     const systemPrompt = ` ${basePrompt}

//           IMPORTANT:
//           - Answer ONLY using the information from UPLOADED KNOWLEDGE.
//           - If the answer is not found there, say you do not have that information.
//           - When information exists in UPLOADED KNOWLEDGE, explain in FULL detail.
//           - Do NOT summarise.
//           - Do NOT stop early.

//           CURRENT DATE , DAY AND TIME (INDIAN STANDARD TIME)
//           Today Date: ${currentDateFormatted}
//           Today Day : ${currentDayFormatted}
//           Current Time: ${currentTimeFormatted}
//           Timezone: Asia Kolkata

//           UPLOADED KNOWLEDGE:
//           ${knowledgeContext}
//         `;

//     const response = await openai.chat.completions.create({
//       model: "gpt-4o",
//       messages: [
//         { role: "system", content: systemPrompt },
//         ...chatHistory,
//         { role: "user", content: cleanMessage },
//       ],
//       temperature: 0.2,
//       top_p: 0.9,
//       max_tokens: 500,
//     });

//     const reply = response?.choices?.[0]?.message?.content;

//     if (!reply || typeof reply !== "string") {
//       return null;
//     }

//     const finalReply = reply.trim();
//     if (finalReply.length === 0) {
//       return null;
//     }

//     return finalReply;
//   } catch (err) {
//     console.error("OpenAI error:", err.message);
//     return null;
//   }
// };

// export const isMessageProcessed = async (messageId) => {
//   const [rows] = await db.sequelize.query(
//     `SELECT message_id
//      FROM ${tableNames.PROCESSEDMESSAGE}
//      WHERE message_id = ?`,
//     { replacements: [messageId] }
//   );
//   return rows.length > 0;
// };

// export const markMessageProcessed = async (messageId, phone) => {
//   await db.sequelize.query(
//     `INSERT IGNORE INTO ${tableNames.PROCESSEDMESSAGE}
//      (message_id, phone)
//      VALUES (?, ?)`,
//     { replacements: [messageId, phone] }
//   );
// };

// export const isChatLocked = async (phone) => {
//   const [rows] = await db.sequelize.query(
//     `
//     SELECT phone
//     FROM ${tableNames.CHATLOCKS}
//     WHERE phone = ?
//       AND created_at > (NOW() - INTERVAL 15 SECOND)
//     `,
//     { replacements: [phone] }
//   );
//   return rows.length > 0;
// };

// export const lockChat = async (phone) => {
//   await db.sequelize.query(
//     `
//     INSERT IGNORE INTO ${tableNames.CHATLOCKS}
//     (phone, created_at)
//     VALUES (?, NOW())
//     `,
//     { replacements: [phone] }
//   );
// };

// export const unlockChat = async (phone) => {
//   await db.sequelize.query(
//     `DELETE FROM ${tableNames.CHATLOCKS} WHERE phone = ?`,
//     { replacements: [phone] }
//   );
// };

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
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
  );

  const day = String(now.getDate()).padStart(2, "0");
  const month = now.toLocaleString("en-US", { month: "long" });
  const year = now.getFullYear();
  const weekday = now.toLocaleString("en-US", { weekday: "long" });

  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;

  const currentDateFormatted = `${day} ${month} ${year}`;
  const currentTimeFormatted = `${String(hours).padStart(
    2,
    "0",
  )} ${minutes} ${ampm}`;
  const currentDayFormatted = weekday;

  console.log(
    "Date/Time",
    currentDateFormatted,
    currentTimeFormatted,
    currentDayFormatted,
  );

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

    const memory = await getConversationMemory(tenant_id, phone, 4);
    const chatHistory = buildChatHistory(memory);

    const activePromptText = await getActivePromptService(tenant_id);

    const basePrompt =
      activePromptText && activePromptText.trim().length > 0
        ? activePromptText
        : DEFAULT_SYSTEM_PROMPT;

    const chunks = await searchKnowledgeChunks(tenant_id, cleanMessage);

    const knowledgeContext =
      chunks && chunks.length > 0
        ? chunks.join("\n\n")
        : "No relevant knowledge available.";

    const systemPrompt = ` ${basePrompt}

          IMPORTANT:
          - Answer ONLY using the information from UPLOADED KNOWLEDGE.
          - If the answer is not found there, say you do not have that information.
          - When information exists in UPLOADED KNOWLEDGE, explain in FULL detail.
          - Do NOT summarise.
          - Do NOT stop early.

          CURRENT DATE , DAY AND TIME (INDIAN STANDARD TIME)
          Today Date: ${currentDateFormatted}
          Today Day : ${currentDayFormatted}
          Current Time: ${currentTimeFormatted}
          Timezone: Asia Kolkata

          UPLOADED KNOWLEDGE:
          ${knowledgeContext}
        `;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        ...chatHistory,
        { role: "user", content: cleanMessage },
      ],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 500,
    });

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
    return null;
  }
};
