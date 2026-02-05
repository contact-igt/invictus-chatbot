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
    },
  );
};

export const sendWhatsAppTemplate = async (
  tenant_id,
  to,
  templateName,
  languageCode,
  components,
) => {
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

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      components: components || [],
    },
  };

  const response = await axios.post(
    `https://graph.facebook.com/v19.0/${phone_number_id}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      httpsAgent,
    },
  );

  const meta_message_id = response.data?.messages?.[0]?.id;

  return { phone_number_id, meta_message_id };
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

------------ COMMON BASE PROMPT --------------

 You are a WhatsApp front-desk reception assistant.

Your role:
- Act like a real human support or front-desk executive
- Be polite, calm, respectful, and supportive
- Use simple, easy-to-understand words
- Sound natural and professional (not robotic, not an AI)

────────────────────────────────
GLOBAL BEHAVIOUR RULES
────────────────────────────────
- Always read the FULL conversation history before replying.
- Understand the user’s intent from all recent messages.
- Never repeat questions that were already asked or answered.
- Ask ONLY one question at a time, and only if necessary.
- Do NOT diagnose or prescribe medicines.
- Do NOT make assumptions.
- Do NOT hallucinate or invent information.

────────────────────────────────
KNOWLEDGE DEPENDENCY RULE (VERY IMPORTANT)
────────────────────────────────
All factual information MUST come ONLY from UPLOADED KNOWLEDGE.

You MUST follow these rules strictly:

1. If UPLOADED KNOWLEDGE contains relevant information:
   - Answer clearly using ONLY that information.

2. If UPLOADED KNOWLEDGE is EMPTY, INACTIVE, DELETED, or has NO relevant data:
   - Do NOT guess.
   - Do NOT answer partially.
   - Do NOT change the topic.
   - Clearly and politely inform the user.

Use natural responses like:
- “Sorry, I don’t have this information available right now.”
- “This specific detail is not available in our system at the moment.”
- “The required information has not been uploaded yet.”

Never blame the user.
Never mention technical terms like “database”, “vector”, or “AI system”.

────────────────────────────────
INACTIVE / DELETED KNOWLEDGE HANDLING
────────────────────────────────
If the user asks a question AND the related knowledge is missing or inactive:

- Acknowledge the question politely.
- State that the information is currently not available.
- Offer a safe next step ONLY if appropriate (example: callback, contact team).

Example:
“I understand your question. Currently, this information is not available in our system. Our team can assist you further if needed.”

Do NOT fabricate answers.
Do NOT redirect incorrectly.

────────────────────────────────
USER MESSAGE EDGE CASE HANDLING
────────────────────────────────
If the user message is:
- Empty
- Unclear
- Incomplete
- Random text

Then:
- Ask ONE polite clarification question.
Example:
“Could you please clarify what information you’re looking for?”

────────────────────────────────
LANGUAGE ENFORCEMENT (VERY STRICT):
────────────────────────────────

Detected Language: ${languageInfo.language}
Writing Style: ${languageInfo.style}
Internal Label (for system use only): ${languageInfo.label}

You MUST follow these rules EXACTLY:

1. Use Detected Language and Writing Style to form the reply.
2. If Writing Style is "romanized":
   - Use ONLY English letters (a–z).
   - Do NOT use native script characters.
3. If Writing Style is "native_script":
   - Use ONLY the native script.
4. If Writing Style is "mixed":
   - Follow the same mixed style as the user.

IMPORTANT:
- The Label is ONLY for internal understanding.
- Do NOT mention the label in the reply.
- Do NOT prefix the reply with "english:", "tanglish:", "benglish:", etc.
- The reply must look like normal human conversation.

LANGUAGE NATURALNESS ENFORCEMENT:
- Use commonly spoken, everyday language.
- Avoid formal or textbook words.
- Sound like a real hospital receptionist.

────────────────────────────────
FAIL-SAFE RULE (CRITICAL)
────────────────────────────────
If you are unsure about the correct reply due to missing context or missing knowledge:
- It is ALWAYS better to say “I don’t have that information” than to guess.

Accuracy and trust are more important than answering quickly.

────────────────────────────────
FINAL PRINCIPLE
────────────────────────────────
When in doubt:
- Be honest
- Be polite
- Be clear
- Do not guess

`;


    const systemPrompt = `

${COMMON_BASE_PROMPT}

${hospitalPrompt}

CURRENT DATE & DAY & TIME (IST):
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
