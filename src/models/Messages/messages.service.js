import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { AiService } from "../Ai/ai.service.js";

export const createUserMessageService = async (
  wa_id,
  phone,
  name,
  sender,
  sender_id,
  message
) => {
  const Query = `INSERT INTO ${tableNames?.MESSAGES} ( wa_id,	 phone,	name,	sender,	sender_id,	message ) VALUES (?,?,?,?,?,?) `;

  try {
    const values = [wa_id, phone, name, sender, sender_id, message];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getChatListService = async () => {
  try {
    const Query = ` 
  SELECT phone , message , seen , name , created_at 
  FROM messages as m1
  WHERE id = (
  SELECT MAX(id) FROM messages as m2
  WHERE m2.phone = m1.phone 
  ) 
  ORDER BY m1.created_at DESC
  
  `;

    const [result] = await db.sequelize.query(Query);
    return result;
  } catch (err) {
    throw err;
  }
};

export const getChatByPhoneService = async (phone) => {
  try {
    const Query = `
    SELECT sender, message, seen , created_at
    FROM  ${tableNames?.MESSAGES}
    WHERE phone = ?
    ORDER BY created_at ASC
  `;
    const [result] = await db.sequelize.query(Query, {
      replacements: [phone],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const markSeenMessageService = async (phone) => {
  const Query = `UPDATE ${tableNames?.MESSAGES} SET seen = "true" WHERE phone = ? AND seen = "false"`;
  try {
    const [result] = await db.sequelize.query(Query, { replacements: [phone] });
    return result;
  } catch (err) {
    throw err;
  }
};

export const suggestReplyService = async (phone) => {
  const ADMIN_SYSTEM_PROMPT = `

  You are a professional customer support executive.

Rules:
- Reply in professional English only.
- Do not use emojis.
- Do not use symbols.
- Be clear, concise, and helpful.
- Do not mention internal systems.
`;

  const [messages] = await db.sequelize.query(
    `
    SELECT sender, message
    FROM ${tableNames.MESSAGES}
    WHERE phone = ?
    ORDER BY created_at ASC
    `,
    { replacements: [phone] }
  );

  const chatHistory = messages
    .map((m) => `${m.sender.toUpperCase()}: ${m.message}`)
    .join("\n");

  const [lastMsg] = await db.sequelize.query(
    `
    SELECT message
    FROM ${tableNames.MESSAGES}
    WHERE phone = ?
      AND sender = 'user'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    { replacements: [phone] }
  );

  if (!lastMsg.length) {
    return "No recent customer message found.";
  }

  const lastUserMessage = lastMsg[0].message;

  /* 3️⃣ Knowledge base search */
  const keywords = lastUserMessage.split(" ").slice(0, 6).join(" ");

  const [knowledge] = await db.sequelize.query(
    `
    SELECT chunk_text
    FROM ${tableNames.KNOWLEDGECHUNKS}
    WHERE chunk_text LIKE ?
    LIMIT 5
    `,
    { replacements: [`%${keywords}%`] }
  );

  const knowledgeText =
    knowledge.length > 0
      ? knowledge.map((k) => k.chunk_text).join("\n")
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

  const reply = await AiService("system", prompt);

  return reply.trim();
};
