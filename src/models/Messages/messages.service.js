import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { AiService } from "../../utils/coreAi.js";

export const createUserMessageService = async (
  tenant_id,
  phone_number_id,
  phone,
  wa_id,
  name,
  sender,
  sender_id,
  message,
) => {
  const Query = `INSERT INTO ${tableNames?.MESSAGES} (  
  tenant_id,
  phone_number_id,
  phone,
  wa_id,	
  name,	
  sender,	
  sender_id,	
  message )
   VALUES (?,?,?,?,?,?,?,?) `;

  try {
    const values = [
      tenant_id,
      phone_number_id,
      phone,
      wa_id,
      name,
      sender,
      sender_id,
      message,
    ];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getChatListService = async (tenant_id) => {
  try {
    const Query = `
      SELECT 
        m1.phone,
        m1.name,
        m1.message,
        m1.seen,
        m1.created_at
      FROM messages m1
      INNER JOIN (
        SELECT 
          phone,
          MAX(created_at) AS last_message_time
        FROM messages
        WHERE tenant_id = ?
        GROUP BY phone
      ) m2
      ON m1.phone = m2.phone
      AND m1.created_at = m2.last_message_time
      WHERE m1.tenant_id = ?
      ORDER BY m1.created_at DESC
    `;

    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, tenant_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getChatByPhoneService = async (phone, tenant_id) => {
  try {
    const Query = `
    SELECT sender, message, seen , created_at
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
  const Query = `UPDATE ${tableNames?.MESSAGES} SET seen = "true" WHERE phone = ? AND seen = "false" AND tenant_id = ?`;
  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [phone, tenant_id],
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
    WHERE phone = ? AND tenant_id = ?
    ORDER BY created_at ASC
    `,
    { replacements: [phone, tenant_id] },
  );

  const chatHistory = messages
    .map((m) => `${m.sender.toUpperCase()}: ${m.message}`)
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

  /* 3️⃣ Knowledge base search */
  const keywords = lastUserMessage.split(" ").slice(0, 6).join(" ");

  const [knowledge] = await db.sequelize.query(
    `
    SELECT chunk_text
    FROM ${tableNames.KNOWLEDGECHUNKS}
    WHERE chunk_text LIKE ?
    LIMIT 5
    `,
    { replacements: [`%${keywords}%`] },
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
