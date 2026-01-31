import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { buildChatHistory } from "../../utils/buildChatHistory.js";
import { calculateHeatState } from "../../utils/calculateHeatState.js";
import cron from "node-cron";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { AiService } from "../../utils/coreAi.js";

export const createLeadService = async (tenant_id, contact_id) => {
  const Query = `INSERT INTO ${tableNames?.LEADS} (tenant_id, contact_id, last_user_message_at) VALUES (?,?, NOW())`;

  console.log("ddd333", tenant_id, contact_id);

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, contact_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getLeadByPhoneService = async (tenant_id, contact_id) => {
  const Query = `
  
  SELECT * FROM ${tableNames?.LEADS} WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false LIMIT 1`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, contact_id],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getLeadListService = async (tenant_id) => {
  const Query = `
  SELECT led.* , cta.* FROM ${tableNames?.LEADS} as led
  LEFT JOIN ${tableNames?.CONTACTS} as cta on (cta.id = led.contact_id)
  WHERE led.tenant_id IN (?) AND led.is_deleted = false
  ORDER BY led.last_user_message_at DESC`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const updateLeadService = async (tenant_id, contact_id) => {
  const { heat_state, heat_score } = calculateHeatState(new Date());

  const Query = `UPDATE ${tableNames?.LEADS} SET last_user_message_at = Now() , heat_state = ?, score = ? , summary_status = ?  WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [heat_state, heat_score, "new", tenant_id, contact_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const updateAdminLeadService = async (tenant_id, contact_id) => {
  const { heat_state, heat_score } = calculateHeatState(new Date());

  const Query = `UPDATE ${tableNames?.LEADS} SET last_admin_reply_at = Now() , heat_state = ?, score = ? , summary_status = ?  WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [heat_state, heat_score, "new", tenant_id, contact_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const startLeadHeatDecayCronService = () => {
  cron.schedule("*/30 * * * *", async () => {
    try {
      console.log("Heat decay cron started");

      await db.sequelize.query(`
        UPDATE ${tableNames?.LEADS}
        SET
          heat_state = CASE
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 4 THEN 'hot'
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 24 THEN 'warm'
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 72 THEN 'cold'
            ELSE 'super_cold'
          END,
           score = CASE
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 4 THEN 90
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 24 THEN 60
            WHEN TIMESTAMPDIFF(HOUR, last_user_message_at, NOW()) <= 72 THEN 30
            ELSE 10
          END
        WHERE is_deleted = false
    `);

      console.log("Heat decay cron finished");
    } catch (err) {
      console.error("Heat decay cron error:", err.message);
      throw err;
    }
  });
};

export const getLeadSummaryService = async (tenant_id, phone, contact_id) => {
  try {
    const memory = await getConversationMemory(tenant_id, phone);

    if (!memory || memory.length === 0) {
      return {
        summary: "No conversation history available for this user.",
        has_data: false,
      };
    }

    const chatHistory = buildChatHistory(memory);
    const lead = await getLeadByPhoneService(tenant_id, contact_id);

    if (lead?.summary_status === "old" && lead?.ai_summary) {
      return {
        summary: lead.ai_summary,
        has_data: true,
      };
    } else {
      const SUMMARIZE_PROMPT = `
    You are an AI assistant generating a time-based overall summary for staff review.

    You will receive a conversation memory containing messages from the user, bot, and admin, each with timestamps.

    Your task:
    - Read the conversation in chronological order.
    - Clearly explain:
      • What the user talked about earlier
      • How the bot responded at that time
      • Whether and when the admin intervened
      • What the user is talking about now based on the most recent messages
    - Describe the conversation flow as past → recent → current.

    Rules:
    - Write only ONE short paragraph.
    - Clearly mention user, bot, and admin roles.
    - Use simple, professional language.
    - Do not assume information that is not mentioned.

    Conversation Memory (JSON):
    ${JSON.stringify(memory, null, 2)}
    `;

      const aiSummary = await AiService("system", SUMMARIZE_PROMPT);

      const Query = `UPDATE ${tableNames.LEADS} SET ai_summary = ? , summary_status = ?  WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false `;

      await db.sequelize.query(Query, {
        replacements: [aiSummary, "old", tenant_id, contact_id],
      });

      return {
        summary: aiSummary,
        has_data: true,
      };
    }
  } catch (err) {
    throw err;
  }
};
// ... existing code ...

export const updateLeadStatusService = async (
  tenant_id,
  contact_id,
  status,
  heat_state,
) => {
  const Query = `UPDATE ${tableNames?.LEADS} SET status = ?, heat_state = ? WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [status, heat_state, tenant_id, contact_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteLeadService = async (tenant_id, contact_id) => {
  const Query = `UPDATE ${tableNames?.LEADS} SET is_deleted = true, deleted_at = NOW() WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, contact_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};
