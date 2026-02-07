import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { buildChatHistory } from "../../utils/buildChatHistory.js";
import { calculateHeatState } from "../../utils/calculateHeatState.js";
import cron from "node-cron";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { AiService } from "../../utils/coreAi.js";

export const createLeadService = async (tenant_id, contact_id, source = null) => {
  const Query = `
    INSERT INTO ${tableNames?.LEADS} 
    (tenant_id, contact_id, source, last_user_message_at) 
    VALUES (?,?,?, NOW())
    ON DUPLICATE KEY UPDATE updated_at = NOW()
  `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, contact_id, source],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getLeadByContactIdService = async (tenant_id, contact_id) => {
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
  SELECT 
    led.id as lead_id,
    led.contact_id,
    led.tenant_id,
    led.status,
    led.heat_state,
    led.score,
    led.ai_summary,
    led.summary_status,
    led.last_user_message_at,
    led.last_admin_reply_at,
    led.created_at as lead_created_at,
    cta.name,
    cta.phone,
    cta.email,
    cta.profile_pic,
    led.lead_stage,
    led.assigned_to,
    led.source,
    led.priority,
    led.internal_notes
  FROM ${tableNames?.LEADS} as led
  LEFT JOIN ${tableNames?.CONTACTS} as cta on (cta.contact_id = led.contact_id)
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
    const lead = await getLeadByContactIdService(tenant_id, contact_id);

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
      • Whether and when the admin intervened (including sending Template messages for outreach)
      • What the user is talking about now based on the most recent messages
    - Describe the conversation flow as: outreach/past → recent interaction → current state.

    Rules:
    - Write only ONE short paragraph.
    - Clearly mention user, bot, and admin roles.
    - IMPORTANT: Include details about Template/Campaign messages sent by Admin/System if they exist in the memory.
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
  lead_stage = null,
  assigned_to = null,
  priority = null,
  internal_notes = null
) => {
  const updates = [];
  const replacements = [];

  if (status) { updates.push("status = ?"); replacements.push(status); }
  if (heat_state) { updates.push("heat_state = ?"); replacements.push(heat_state); }
  if (lead_stage) { updates.push("lead_stage = ?"); replacements.push(lead_stage); }
  if (assigned_to !== null) { updates.push("assigned_to = ?"); replacements.push(assigned_to); }
  if (priority) { updates.push("priority = ?"); replacements.push(priority); }
  if (internal_notes !== null) { updates.push("internal_notes = ?"); replacements.push(internal_notes); }

  if (updates.length === 0) return null;

  const Query = `UPDATE ${tableNames?.LEADS} SET ${updates.join(", ")} WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false`;
  replacements.push(tenant_id, contact_id);

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements,
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

export const permanentDeleteLeadService = async (tenant_id, contact_id) => {
  const Query = `DELETE FROM ${tableNames?.LEADS} WHERE tenant_id = ? AND contact_id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, contact_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

/**
 * Retrieves a list of soft-deleted leads for a tenant.
 */
export const getDeletedLeadListService = async (tenant_id, query) => {
  const { state, stage, priority, search, page = 1, limit = 10 } = query;
  const offset = (page - 1) * limit;

  let where = { tenant_id, is_deleted: true };
  if (state) where.heat_state = state;
  if (stage) where.lead_stage = stage;
  if (priority) where.priority = priority;
  if (search) {
    where[db.Sequelize.Op.or] = [
      { ai_summary: { [db.Sequelize.Op.like]: `%${search}%` } },
    ];
  }

  const { count, rows } = await db.Leads.findAndCountAll({
    where,
    order: [["deleted_at", "DESC"]],
    limit: parseInt(limit),
    offset: parseInt(offset),
    include: [
      {
        model: db.Contacts,
        as: "contact",
        attributes: ["name", "phone", "email"],
      },
    ],
  });

  return {
    totalItems: count,
    leads: rows,
    totalPages: Math.ceil(count / limit),
    currentPage: parseInt(page),
  };
};

/**
 * Restore a soft-deleted lead
 */
export const restoreLeadService = async (id, tenant_id) => {
  const lead = await db.Leads.findOne({
    where: { id, tenant_id, is_deleted: true }
  });

  if (!lead) {
    throw new Error("Lead not found or not deleted");
  }

  await lead.update({
    is_deleted: false,
    deleted_at: null
  });

  return { message: "Lead restored successfully" };
};
