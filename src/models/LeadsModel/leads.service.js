import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { calculateHeatState } from "../../utils/helpers/calculateHeatState.js";
import cron from "node-cron";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { AiService } from "../../utils/ai/coreAi.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";

export const createLeadService = async (tenant_id, contact_id, source = null) => {
  try {
    const lead_id = await generateReadableIdFromLast(
      tableNames.LEADS,
      "lead_id",
      "L",
      3
    );

    const Query = `
    INSERT INTO ${tableNames?.LEADS} 
    (tenant_id, contact_id, lead_id, source, last_user_message_at) 
    VALUES (?, ?, ?, ?, NOW())
    ON DUPLICATE KEY UPDATE updated_at = NOW()
  `;

    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, contact_id, lead_id, source],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getLeadByLeadIdService = async (tenant_id, lead_id) => {
  const Query = `
  SELECT * FROM ${tableNames?.LEADS} WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false LIMIT 1`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_id],
    });
    return result[0];
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
  const dataQuery = `
  SELECT 
    led.lead_id,
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
  WHERE led.tenant_id = ? AND led.is_deleted = false
  ORDER BY led.last_user_message_at DESC`;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    return {
      leads: rows,
    };
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

export const getLeadSummaryService = async (
  tenant_id,
  phone,
  lead_id,
  mode = null,
  targetDate = null,
  startDateParam = null,
  endDateParam = null
) => {
  try {
    const memory = await getConversationMemory(tenant_id, phone);

    if (!memory || memory.length === 0) {
      return {
        summary: "No conversation history available for this lead.",
        has_data: false,
      };
    }

    let filteredMemory = memory;
    let promptInstruction = "";

    // 1. Calculate Local Dates for Asia/Kolkata (IST)
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    let startDate = startDateParam;
    let endDate = endDateParam;

    // 2. Resolve Presets in IST
    if (targetDate === "today") {
      startDate = endDate = todayStr;
    } else if (targetDate === "yesterday") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = endDate = yesterday.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    } else if (targetDate === "last_week") {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);
      startDate = lastWeek.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      endDate = todayStr;
    } else if (targetDate === "last_month") {
      const lastMonth = new Date();
      lastMonth.setDate(lastMonth.getDate() - 30);
      startDate = lastMonth.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      endDate = todayStr;
    } else if (targetDate === "last_year") {
      const lastYear = new Date();
      lastYear.setDate(lastYear.getDate() - 365);
      startDate = lastYear.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      endDate = todayStr;
    } else if (targetDate && !startDate && !endDate) {
      // Single specific day filter
      startDate = endDate = targetDate;
    }

    // 3. APPLY STRICT FILTERING
    if (startDate && endDate) {
      console.log(`Summary Filtering (IST): [${startDate}] to [${endDate}]`);
      filteredMemory = memory.filter(m => {
        // Fix: Use 'created_at' as returned by getConversationMemory, not 'timestamp'
        if (!m.created_at) return false;

        let msgDate = "";
        try {
          // Robust Timezone Conversion
          const dateObj = new Date(m.created_at);
          msgDate = dateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        } catch (e) {
          console.error("Date parse error for:", m.created_at);
          return false;
        }

        return msgDate >= startDate && msgDate <= endDate;
      });

      if (filteredMemory.length === 0) {
        const rangeInfo = startDate === endDate ? `on ${startDate}` : `between ${startDate} and ${endDate}`;
        return {
          summary: `No interaction found ${rangeInfo}.`,
          has_data: false
        };
      }

      promptInstruction = startDate === endDate
        ? `Summarize what happened on ${startDate} in 3-4 simple sentences. Explain what the client wanted and the result. Max 5 lines.`
        : `Summarize interactions between ${startDate} and ${endDate} in 4-5 simple sentences. Explain the main topic and status. Max 5 lines.`;

    } else if (mode === "detailed") {
      // Timeline mode for the entire lead history
      promptInstruction = `Provide a chronological daily log. For each date, give 1 simple sentence. 
      Format: **YYYY-MM-DD**: [1-sentence summary]`;
    } else {
      // DEFAULT: Overall snapshot 
      filteredMemory = memory.slice(-20);
      promptInstruction = `Provide a simple 4-5 line "Status Report."
      - Who is the client and why did they reach out?
      - What are the key details?
      - What is the current status and next step?
      Keep it simple and easy to read. Max 5 lines.`;
    }

    const SUMMARIZE_PROMPT = `
    You are an AI assistant helping a Business Admin. 
    Task: ${promptInstruction}

    Rules:
    - **Use simple, everyday English.**
    - **Avoid complex words or corporate jargon.**
    - **Keep it short: Maximum 5 lines of text.**
    - Focus on THE MEANING.
    - DO NOT use labels like "User:", "Bot:", or "Admin:". 
    - No preamble. Start directly with the summary.

    Conversation History (JSON):
    ${JSON.stringify(filteredMemory, null, 2)}
    `;

    const aiSummary = await AiService("system", SUMMARIZE_PROMPT);

    // Only save to DB if it's the overall status (no filters applied)
    if (!startDate || mode === "overall") {
      const Query = `UPDATE ${tableNames.LEADS} SET ai_summary = ? , summary_status = ?  WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false `;
      await db.sequelize.query(Query, {
        replacements: [aiSummary, "old", tenant_id, lead_id],
      });
    }

    return {
      summary: aiSummary,
      has_data: true,
      mode: mode || (startDate ? "period" : "overall"),
      date: startDate === endDate ? startDate : null
    };
  } catch (err) {
    console.error("Error in getLeadSummaryService:", err);
    throw err;
  }
};

export const updateLeadStatusService = async (
  tenant_id,
  lead_id,
  status,
  heat_state,
  lead_stage = null,
  assigned_to = null,
  priority = null,
  source = null,
  internal_notes = null
) => {
  const updates = [];
  const replacements = [];

  if (status) { updates.push("status = ?"); replacements.push(status); }
  if (heat_state) { updates.push("heat_state = ?"); replacements.push(heat_state); }
  if (lead_stage) { updates.push("lead_stage = ?"); replacements.push(lead_stage); }
  if (assigned_to !== null) { updates.push("assigned_to = ?"); replacements.push(assigned_to); }
  if (priority) { updates.push("priority = ?"); replacements.push(priority); }
  if (source) { updates.push("source = ?"); replacements.push(source); }
  if (internal_notes !== null) { updates.push("internal_notes = ?"); replacements.push(internal_notes); }

  if (updates.length === 0) return null;

  const Query = `UPDATE ${tableNames?.LEADS} SET ${updates.join(", ")} WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false`;
  replacements.push(tenant_id, lead_id);

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteLeadService = async (tenant_id, lead_id) => {
  const Query = `UPDATE ${tableNames?.LEADS} SET is_deleted = true, deleted_at = NOW() WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const permanentDeleteLeadService = async (tenant_id, lead_id) => {
  const Query = `DELETE FROM ${tableNames?.LEADS} WHERE tenant_id = ? AND lead_id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

/**
 * Retrieves a list of soft-deleted leads for a tenant.
 */
export const getDeletedLeadListService = async (tenant_id) => {
  const where = { tenant_id, is_deleted: true };

  const { count, rows } = await db.Leads.findAndCountAll({
    where,
    order: [["deleted_at", "DESC"]],
    include: [
      {
        model: db.Contacts,
        as: "contact",
        attributes: ["name", "phone", "email"],
      },
    ],
  });

  return {
    leads: rows,
  };
};

/**
 * Restore a soft-deleted lead
 */
export const restoreLeadService = async (lead_id, tenant_id) => {
  const Query = `UPDATE ${tableNames?.LEADS} SET is_deleted = false, deleted_at = NULL WHERE tenant_id = ? AND lead_id = ? AND is_deleted = true`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_id],
    });

    if (result.affectedRows === 0) {
      throw new Error("Lead not found or not deleted");
    }

    return { message: "Lead restored successfully" };
  } catch (err) {
    throw err;
  }
};
