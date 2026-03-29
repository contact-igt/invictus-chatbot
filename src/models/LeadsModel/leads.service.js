import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { calculateHeatState } from "../../utils/helpers/calculateHeatState.js";
import cron from "node-cron";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { AiService } from "../../utils/ai/coreAi.js";
import {
  getLeadSummarizePrompt,
  getLeadSummaryModeInstruction,
} from "../../utils/ai/prompts/index.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";

export const createLeadService = async (
  tenant_id,
  contact_id,
  source = "none",
) => {
  try {
    const lead_id = await generateReadableIdFromLast(
      tableNames.LEADS,
      "lead_id",
      "L",
      3,
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
      led.ai_summary_created_at,
      led.created_at as lead_created_at,
      cta.name,
      cta.phone,
      cta.email,
      cta.profile_pic,
      led.lead_stage,
      led.assigned_to,
      agent.username AS assigned_agent_name,
      led.source,
      led.priority,
      led.internal_notes
    FROM ${tableNames?.LEADS} as led
    LEFT JOIN ${tableNames?.CONTACTS} as cta on (cta.contact_id = led.contact_id AND cta.tenant_id = led.tenant_id)
    LEFT JOIN ${tableNames?.TENANT_USERS} as agent on (agent.tenant_user_id = led.assigned_to)
    WHERE led.tenant_id = ? AND led.lead_id = ? AND led.is_deleted = false
    LIMIT 1`;

  try {
    const [leads] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id, lead_id],
    });

    if (!leads.length) {
      return null;
    }

    const lead = leads[0];

    // Fetch last 4 messages for this lead (MySQL 5.7 compatible)
    const messagesQuery = `
      SELECT contact_id, sender, message, created_at FROM (
        SELECT contact_id, sender, message, created_at
        FROM ${tableNames.MESSAGES}
        WHERE tenant_id = ? AND contact_id = ?
        ORDER BY created_at DESC
        LIMIT 4
      ) as recent
      ORDER BY created_at ASC
    `;

    const [messages] = await db.sequelize.query(messagesQuery, {
      replacements: [tenant_id, lead.contact_id],
    });

    return {
      ...lead,
      last_messages: messages || [],
    };
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
    led.ai_summary_created_at,
    led.created_at as lead_created_at,
    cta.name,
    cta.phone,
    cta.email,
    cta.profile_pic,
    led.lead_stage,
    led.assigned_to,
    agent.username AS assigned_agent_name,
    led.source,
    led.priority,
    led.internal_notes
  FROM ${tableNames?.LEADS} as led
  LEFT JOIN ${tableNames?.CONTACTS} as cta on (cta.contact_id = led.contact_id AND cta.tenant_id = led.tenant_id)
  LEFT JOIN ${tableNames?.TENANT_USERS} as agent on (agent.tenant_user_id = led.assigned_to)
  WHERE led.tenant_id = ? AND led.is_deleted = false
  ORDER BY led.last_user_message_at DESC`;

  try {
    const [leads] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    if (!leads.length) {
      return { leads: [] };
    }

    // 2. Fetch last 4 messages for these leads for preview
    const contactIds = leads.map((l) => l.contact_id);
    const messagesQuery = `
      SELECT contact_id, sender, message, created_at
      FROM (
        SELECT 
          contact_id, sender, message, created_at,
          ROW_NUMBER() OVER(PARTITION BY contact_id ORDER BY created_at DESC) as rn
        FROM ${tableNames.MESSAGES}
        WHERE tenant_id = ? AND contact_id IN (?)
      ) as ranked
      WHERE rn <= 4
      ORDER BY contact_id, created_at ASC
    `;

    const [allMessages] = await db.sequelize.query(messagesQuery, {
      replacements: [tenant_id, contactIds],
    });

    // 3. Group messages by contact_id and attach to leads
    const messagesMap = allMessages.reduce((acc, msg) => {
      if (!acc[msg.contact_id]) acc[msg.contact_id] = [];
      acc[msg.contact_id].push(msg);
      return acc;
    }, {});

    const leadsWithMessages = leads.map((lead) => ({
      ...lead,
      last_messages: messagesMap[lead.contact_id] || [],
    }));

    return {
      leads: leadsWithMessages,
    };
  } catch (err) {
    console.error("Error in getLeadListService:", err.message);
    throw err;
  }
};

export const updateLeadService = async (tenant_id, contact_id) => {
  const { heat_state, heat_score } = calculateHeatState(new Date());

  const Query = `UPDATE ${tableNames?.LEADS} SET last_user_message_at = Now() , heat_state = ?, score = ? , summary_status = ?  WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false`;

  try {
    console.log("[DEBUG-HEAT] Updating specific lead:", {
      tenant_id,
      contact_id,
      heat_score,
    });
    const [result] = await db.sequelize.query(Query, {
      replacements: [heat_state, heat_score, "new", tenant_id, contact_id],
    });
    console.log("[DEBUG-HEAT] Key Update Result (info):", result);

    return result;
  } catch (err) {
    console.error("[DEBUG-HEAT] Error updating lead:", err);
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
            ELSE 'supercold'
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

export const getBulkLeadSummaryService = async (
  tenant_id,
  lead_ids,
  mode = null,
  targetDate = null,
  startDateParam = null,
  endDateParam = null,
) => {
  try {
    if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0) {
      throw new Error("Invalid lead_ids provided");
    }
    const Query = `
      SELECT led.lead_id, led.contact_id, cta.phone 
      FROM ${tableNames.LEADS} as led
      LEFT JOIN ${tableNames.CONTACTS} as cta ON (cta.contact_id = led.contact_id)
      WHERE led.tenant_id = ? AND led.lead_id IN (?) AND led.is_deleted = false
    `;

    const [leads] = await db.sequelize.query(Query, {
      replacements: [tenant_id, lead_ids],
    });

    if (!leads.length) {
      return [];
    }

    // 2. Process in parallel (Limit concurrency if needed, e.g. using p-limit or just Promise.all for small batches)
    // Assuming reasonable batch size from frontend (e.g. 5-10)
    const summaryPromises = leads.map(async (lead) => {
      try {
        if (!lead.phone) {
          return {
            lead_id: lead.lead_id,
            error: "Phone number not found for this lead",
          };
        }

        const result = await getLeadSummaryService(
          tenant_id,
          lead.phone,
          lead.lead_id,
          mode,
          targetDate,
          startDateParam,
          endDateParam,
          lead.contact_id,
        );

        return {
          lead_id: lead.lead_id,
          ...result,
        };
      } catch (err) {
        return {
          lead_id: lead.lead_id,
          error: err.message || "Failed to generate summary",
        };
      }
    });

    const results = await Promise.all(summaryPromises);
    return results;
  } catch (err) {
    console.error("Error in getBulkLeadSummaryService:", err);
    throw err;
  }
};

export const getLeadSummaryService = async (
  tenant_id,
  phone,
  lead_id = null,
  mode = null,
  targetDate = null,
  startDateParam = null,
  endDateParam = null,
  contact_id = null,
) => {
  try {
    const sanitize = (val) =>
      val === "null" || val === "undefined" || !val ? null : val;

    const cleanMode = sanitize(mode);
    const cleanTargetDate = sanitize(targetDate);
    const cleanStartDate = sanitize(startDateParam);
    const cleanEndDate = sanitize(endDateParam);

    const hasDateFilter = !!(cleanTargetDate || cleanStartDate || cleanEndDate);
    const resultingMode =
      cleanMode === "detailed" || hasDateFilter ? "filtered" : "overall";

    let startDate = cleanStartDate;
    let endDate = cleanEndDate;
    if (cleanTargetDate === "today") {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      startDate = endDate = today;
    } else if (cleanTargetDate === "yesterday") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      startDate = endDate = yesterday.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
    } else if (cleanTargetDate && !cleanStartDate && !cleanEndDate) {
      startDate = endDate = cleanTargetDate;
    }

    let activeLeadId = lead_id;
    if (!activeLeadId && contact_id) {
      const lead = await getLeadByContactIdService(tenant_id, contact_id);
      activeLeadId = lead?.lead_id;
    }

    let currentLead = null;
    if (activeLeadId) {
      currentLead = await getLeadByLeadIdService(tenant_id, activeLeadId);
    }

    if (
      resultingMode === "overall" &&
      currentLead?.summary_status === "old" &&
      currentLead?.ai_summary
    ) {
      console.log(
        `[AI-SUMMARY] Cache Hit! Returning saved overall summary for lead: ${activeLeadId}`,
      );
      return {
        summary: currentLead.ai_summary,
        has_data: true,
        mode: "overall",
        date: null,
        cached: true,
        summary_created_at: currentLead.ai_summary_created_at,
      };
    }

    // Update lead_id to the resolved one for subsequent DB updates
    lead_id = activeLeadId;

    // 5. No cache? (Status is 'new' OR filters applied) -> Proceed with AI generation
    const memory = await getConversationMemory(
      tenant_id,
      phone,
      contact_id || currentLead?.contact_id,
    );

    if (!memory || memory.length === 0) {
      return {
        summary: "No conversation history available for this lead.",
        has_data: false,
      };
    }

    let filteredMemory = memory;
    let promptInstruction = "";
    const todayStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });

    // Re-apply date filters for memory slicing
    if (cleanTargetDate === "last_week") {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 7);
      startDate = lastWeek.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      endDate = todayStr;
    } else if (cleanTargetDate === "last_month") {
      const lastMonth = new Date();
      lastMonth.setDate(lastMonth.getDate() - 30);
      startDate = lastMonth.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      endDate = todayStr;
    } else if (cleanTargetDate === "last_year") {
      const lastYear = new Date();
      lastYear.setDate(lastYear.getDate() - 365);
      startDate = lastYear.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata",
      });
      endDate = todayStr;
    }

    if (startDate && endDate) {
      console.log(`Summary Filtering (IST): [${startDate}] to [${endDate}]`);
      filteredMemory = memory.filter((m) => {
        if (!m.created_at) return false;
        let msgDate = "";
        try {
          const dateObj = new Date(m.created_at);
          msgDate = dateObj.toLocaleDateString("en-CA", {
            timeZone: "Asia/Kolkata",
          });
        } catch (e) {
          return false;
        }
        return msgDate >= startDate && msgDate <= endDate;
      });

      if (filteredMemory.length === 0) {
        const rangeInfo =
          startDate === endDate
            ? `on ${startDate}`
            : `between ${startDate} and ${endDate}`;
        return {
          summary: `No interaction found ${rangeInfo}.`,
          has_data: false,
        };
      }

      promptInstruction = getLeadSummaryModeInstruction(
        cleanMode,
        startDate,
        endDate,
      );
    } else {
      // Default / Overall mode logic
      filteredMemory = memory.slice(-20);
      promptInstruction = getLeadSummaryModeInstruction(cleanMode, null, null);
    }

    const SUMMARIZE_PROMPT = getLeadSummarizePrompt(
      promptInstruction,
      JSON.stringify(filteredMemory, null, 2),
    );

    // 6. Generate Summary
    let aiSummary;
    try {
      aiSummary = await AiService(
        "system",
        SUMMARIZE_PROMPT,
        tenant_id,
        "lead_summary",
      );
    } catch (aiErr) {
      console.error("[AI-SUMMARY] AI generation failed:", aiErr.message);
      return {
        summary:
          "Unable to generate summary at this time. Please try again later.",
        has_data: false,
        mode: resultingMode,
        error: true,
      };
    }

    // 7. DB UPDATE LOGIC (Strictly Lazy)
    //    We ONLY update the DB if we are in 'overall' mode.
    //    Date-filtered summaries are temporary/view-only and should NOT overwrite the main status.
    let summaryCreatedAt = null;

    const isTodayFilter = startDate === todayStr && endDate === todayStr;

    if (
      lead_id &&
      (resultingMode === "overall" ||
        (isTodayFilter && currentLead?.summary_status === "new"))
    ) {
      try {
        // Update Summary + Set Status to 'old' + Set Timestamp
        await db.sequelize.query(
          `UPDATE ${tableNames.LEADS} 
           SET ai_summary = ?, summary_status = 'old', ai_summary_created_at = NOW()
           WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false`,
          {
            replacements: [aiSummary, tenant_id, lead_id],
            type: db.Sequelize.QueryTypes.UPDATE,
          },
        );
        summaryCreatedAt = new Date(); // Approximate timestamp for immediate return
        console.log(
          `[AI-SUMMARY] Saved usage-based summary & marked as 'old' for lead: ${lead_id} (Mode: ${resultingMode})`,
        );
      } catch (saveErr) {
        console.error("[AI-SUMMARY] Error saving summary:", saveErr.message);
      }
    } else {
      console.log(
        `[AI-SUMMARY] generated (Mode: ${resultingMode}, Status: ${currentLead?.summary_status}) - NOT saving to DB to preserve overall status.`,
      );
    }

    return {
      summary: aiSummary,
      has_data: true,
      mode: resultingMode,
      date: startDate === endDate ? startDate : null,
      summary_created_at:
        summaryCreatedAt || currentLead?.ai_summary_created_at,
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
  lead_stage = undefined,
  assigned_to = undefined,
  priority = undefined,
  source = undefined,
  internal_notes = undefined,
  summary_status = undefined,
) => {
  const updates = [];
  const replacements = [];

  if (status !== undefined) {
    updates.push("status = ?");
    replacements.push(status);
  }
  if (heat_state !== undefined) {
    updates.push("heat_state = ?");
    replacements.push(heat_state);
  }
  if (lead_stage !== undefined) {
    updates.push("lead_stage = ?");
    replacements.push(lead_stage);
  }
  if (assigned_to !== undefined) {
    updates.push("assigned_to = ?");
    replacements.push(assigned_to);
  }
  if (priority !== undefined) {
    updates.push("priority = ?");
    replacements.push(priority);
  }
  if (source !== undefined) {
    updates.push("source = ?");
    replacements.push(source);
  }
  if (internal_notes !== undefined) {
    updates.push("internal_notes = ?");
    replacements.push(internal_notes);
  }
  if (summary_status !== undefined) {
    updates.push("summary_status = ?");
    replacements.push(summary_status);
  }

  if (updates.length === 0) return null;

  const Query = `UPDATE ${tableNames?.LEADS} SET ${updates.join(", ")} WHERE tenant_id = ? AND lead_id = ? AND is_deleted = false`;
  replacements.push(tenant_id, lead_id);

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements,
    });

    // ─── SYNC WITH LIVECHAT ──────────────────────────────────────────────────
    if (assigned_to !== undefined) {
      const lead = await getLeadByLeadIdService(tenant_id, lead_id);
      if (lead?.contact_id) {
        const syncQuery = `UPDATE ${tableNames.LIVECHAT} SET assigned_admin_id = ? WHERE tenant_id = ? AND contact_id = ?`;
        await db.sequelize.query(syncQuery, {
          replacements: [assigned_to, tenant_id, lead.contact_id],
        });
      }
    }

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

export const getDeletedLeadListService = async (tenant_id) => {
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
    agent.username AS assigned_agent_name,
    led.source,
    led.priority,
    led.internal_notes,
    led.deleted_at
  FROM ${tableNames?.LEADS} as led
  LEFT JOIN ${tableNames?.CONTACTS} as cta on (cta.contact_id = led.contact_id AND cta.tenant_id = led.tenant_id)
  LEFT JOIN ${tableNames?.TENANT_USERS} as agent on (agent.tenant_user_id = led.assigned_to)
  WHERE led.tenant_id = ? AND led.is_deleted = true
  ORDER BY led.deleted_at DESC`;

  try {
    const [leads] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    if (!leads.length) {
      return { leads: [] };
    }

    // 2. Fetch last 4 messages per lead (MySQL 5.7 compatible)
    const contactIds = leads.map((l) => l.contact_id);
    let messagesMap = {};

    if (contactIds.length > 0) {
      const messagesQuery = `
        SELECT m.contact_id, m.sender, m.message, m.created_at
        FROM ${tableNames.MESSAGES} m
        INNER JOIN (
          SELECT contact_id, MAX(created_at) as max_created
          FROM ${tableNames.MESSAGES}
          WHERE tenant_id = ? AND contact_id IN (?)
          GROUP BY contact_id
        ) latest ON m.contact_id = latest.contact_id
        WHERE m.tenant_id = ? AND m.contact_id IN (?)
        AND m.created_at >= DATE_SUB(latest.max_created, INTERVAL 7 DAY)
        ORDER BY m.contact_id, m.created_at DESC
      `;

      const [allMessages] = await db.sequelize.query(messagesQuery, {
        replacements: [tenant_id, contactIds, tenant_id, contactIds],
      });

      // Group by contact_id and keep only last 4 per contact
      const grouped = allMessages.reduce((acc, msg) => {
        if (!acc[msg.contact_id]) acc[msg.contact_id] = [];
        if (acc[msg.contact_id].length < 4) {
          acc[msg.contact_id].push(msg);
        }
        return acc;
      }, {});

      // Reverse to chronological order
      messagesMap = Object.fromEntries(
        Object.entries(grouped).map(([id, msgs]) => [id, msgs.reverse()]),
      );
    }

    const leadsWithMessages = leads.map((lead) => ({
      ...lead,
      last_messages: messagesMap[lead.contact_id] || [],
    }));

    return {
      leads: leadsWithMessages,
    };
  } catch (err) {
    console.error("Error in getDeletedLeadListService:", err.message);
    throw err;
  }
};

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

export const bulkUpdateLeadsService = async (tenant_id, lead_ids, updates) => {
  if (!lead_ids || !Array.isArray(lead_ids) || lead_ids.length === 0)
    return null;

  const setClauses = [];
  const replacements = [];

  if (updates.status) {
    setClauses.push("status = ?");
    replacements.push(updates.status);
  }
  if (updates.heat_state) {
    setClauses.push("heat_state = ?");
    replacements.push(updates.heat_state);
  }
  if (updates.lead_stage) {
    setClauses.push("lead_stage = ?");
    replacements.push(updates.lead_stage);
  }
  if (updates.assigned_to !== undefined) {
    setClauses.push("assigned_to = ?");
    replacements.push(updates.assigned_to);
  }
  if (updates.priority) {
    setClauses.push("priority = ?");
    replacements.push(updates.priority);
  }
  if (updates.source) {
    setClauses.push("source = ?");
    replacements.push(updates.source);
  }

  if (setClauses.length === 0) return null;

  const Query = `
    UPDATE ${tableNames.LEADS} 
    SET ${setClauses.join(", ")}, updated_at = NOW()
    WHERE tenant_id = ? AND lead_id IN (?) AND is_deleted = false
  `;

  replacements.push(tenant_id, lead_ids);

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements,
    });

    // ─── SYNC WITH LIVECHAT ──────────────────────────────────────────────────
    if (updates.assigned_to !== undefined) {
      const leadsQuery = `SELECT contact_id FROM ${tableNames.LEADS} WHERE tenant_id = ? AND lead_id IN (?)`;
      const [leads] = await db.sequelize.query(leadsQuery, {
        replacements: [tenant_id, lead_ids],
      });
      const contactIds = leads.map((l) => l.contact_id).filter(Boolean);

      if (contactIds.length > 0) {
        const syncQuery = `UPDATE ${tableNames.LIVECHAT} SET assigned_admin_id = ? WHERE tenant_id = ? AND contact_id IN (?)`;
        await db.sequelize.query(syncQuery, {
          replacements: [updates.assigned_to, tenant_id, contactIds],
        });
      }
    }

    return result;
  } catch (err) {
    throw err;
  }
};
