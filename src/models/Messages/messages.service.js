import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { AiService } from "../../utils/ai/coreAi.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { classifyResponse } from "../../utils/ai/responseClassifier.js";
import { handleClassification } from "../../utils/ai/classificationHandler.js";

export const createUserMessageService = async (
  tenant_id,
  contact_id,
  phone_number_id,
  phone,
  wamid,
  name,
  sender,
  sender_id,
  message,
  message_type = "text",
  media_url = null,
  media_mime_type = null,
  status = null,
) => {
  const Query = `INSERT INTO ${tableNames?.MESSAGES} (  
  tenant_id,
  contact_id,
  phone_number_id,
  phone,
  wamid,
  name,
  sender,
  sender_id,
  message,
  message_type,
  media_url,
  media_mime_type,
  status )
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) `;

  try {
    const values = [
      tenant_id,
      contact_id,
      phone_number_id,
      phone,
      wamid,
      name,
      sender,
      sender_id,
      message,
      message_type,
      media_url,
      media_mime_type,
      status,
    ];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return { id: result };
  } catch (err) {
    throw err;
  }
};

export const getChatListService = async (tenant_id) => {
  const dataQuery = `
  SELECT
    m.contact_id,
    c.phone,
    c.name,
    m.message,
    m.seen,
    m.created_at AS last_message_at
  FROM messages m
  INNER JOIN (
    SELECT
      contact_id,
      MAX(created_at) AS last_message_time
    FROM messages
    WHERE tenant_id = ?
    GROUP BY contact_id
  ) lm
    ON m.contact_id = lm.contact_id
   AND m.created_at = lm.last_message_time
  JOIN contacts c
    ON c.contact_id = m.contact_id
  LEFT JOIN ${tableNames.LIVECHAT} lc
    ON lc.contact_id = m.contact_id
   AND lc.tenant_id = ?
  WHERE m.tenant_id = ?
    AND lc.contact_id IS NULL
  ORDER BY m.created_at DESC
`;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id, tenant_id, tenant_id],
    });

    return rows;
  } catch (err) {
    throw err;
  }
};

export const getChatByPhoneService = async (phone, tenant_id) => {
  try {
    const Query = `
    SELECT contact_id , sender, message, seen , created_at
    FROM  ${tableNames?.MESSAGES}
    WHERE phone = ? AND tenant_id = ?
    ORDER BY created_at ASC
  `;
    const [result] = await db.sequelize.query(Query, {
      replacements: [phone, tenant_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const markSeenMessageService = async (tenant_id, phone) => {
  const Query = `UPDATE ${tableNames?.MESSAGES} SET seen = ? WHERE phone = ? AND seen = ? AND tenant_id = ?`;
  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [true, phone, false, tenant_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const suggestReplyService = async (tenant_id, phone) => {
  const ADMIN_SYSTEM_PROMPT = `
You are a professional customer support executive.

Rules:
1. Relevance Check:
   - If "Relevant knowledge" contains a "[Previous Question]" and "[Admin Resolution]", you MUST verify if it applies to the CURRENT question.
   - If the previous question is about a different topic (e.g., Question A is about "refunds", current question is about "shipping"), do NOT use that resolution.
2. Missing Knowledge:
   - If the information is NOT found or NOT relevant:
   - You MUST end your response with: [MISSING_KNOWLEDGE: brief reason]
   - Example: I'm sorry, I don't have information about the pricing at the moment. [MISSING_KNOWLEDGE: pricing not found]
3. Professional English only.
4. No emojis or symbols.
5. Be clear and helpful.
`;

  const [messages] = await db.sequelize.query(
    `
    SELECT sender, message
    FROM ${tableNames.MESSAGES}
    WHERE phone = ? AND tenant_id = ?
  ORDER BY created_at ASC
    `,
    { replacements: [phone, tenant_id] },
  );

  const chatHistory = messages
    .map((m) => `${m.sender.toUpperCase()}: ${m.message} `)
    .join("\n");

  const [lastMsg] = await db.sequelize.query(
    `
    SELECT message
    FROM ${tableNames.MESSAGES}
    WHERE phone = ?
  AND sender = 'user' AND tenant_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `,
    { replacements: [phone, tenant_id] },
  );

  if (!lastMsg.length) {
    return "No recent customer message found.";
  }

  const lastUserMessage = lastMsg[0].message;

  /* 3️⃣ Knowledge base search (Uses Smart AI Retrieval internally) */
  const chunks = await searchKnowledgeChunks(tenant_id, lastUserMessage);

  const knowledgeText =
    chunks && chunks.length > 0
      ? chunks.join("\n\n")
      : "No relevant knowledge found.";

  /* 4️⃣ AI prompt */
  const prompt = `
${ADMIN_SYSTEM_PROMPT}

Conversation history:
${chatHistory}

Last customer message:
${lastUserMessage}

Relevant knowledge:
${knowledgeText}

Task:
Write a professional reply to the last customer message.

  Reply:
`;

  const rawReply = await AiService("system", prompt);

  console.log("[AI-RAW-RESPONSE]", rawReply);

  // Step 1: Process tags (Self-Tagging) and extract metadata
  const processed = await processResponse(rawReply, {
    tenant_id,
    userMessage: lastUserMessage,
  });

  const cleanReply = processed.message;

  // Step 2: Dual-AI Classification (Standardized single logging)
  try {
    const classification = await classifyResponse(lastUserMessage, cleanReply);

    // If the primary AI explicitly tagged missing knowledge or out of scope, use that as a "hint"
    if (processed.tagDetected === "MISSING_KNOWLEDGE" && classification.category !== "MISSING_KNOWLEDGE") {
      classification.category = "MISSING_KNOWLEDGE";
      classification.reason = processed.tagPayload || classification.reason;
    } else if (processed.tagDetected === "OUT_OF_SCOPE" && classification.category !== "OUT_OF_SCOPE") {
      classification.category = "OUT_OF_SCOPE";
      classification.reason = processed.tagPayload || classification.reason;
    }

    await handleClassification(classification, {
      tenant_id,
      userMessage: lastUserMessage,
      aiResponse: cleanReply,
    });
  } catch (classifierError) {
    console.error("[CLASSIFIER-ADMIN] Error:", classifierError.message);
  }

  console.log("[AI-CLEAN-RESPONSE]", cleanReply);

  return cleanReply;
};
