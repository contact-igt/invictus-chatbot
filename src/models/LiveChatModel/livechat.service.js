import { tableNames } from "../../database/tableName.js";
import db from "../../database/index.js";
import cron from "node-cron";

export const createLiveChatService = async (
  tenant_id,
  contact_id,
  status = "active",
) => {
  const Query = ` INSERT INTO ${tableNames?.LIVECHAT} (tenant_id, contact_id, status, last_message_at) VALUES (?,?,?,NOW())`;

  const Values = [tenant_id, contact_id, status];

  try {
    const [result] = await db.sequelize.query(Query, { replacements: Values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getLivechatByIdService = async (tenant_id, contact_id) => {
  const Query = ` SELECT * FROM ${tableNames?.LIVECHAT} WHERE tenant_id = ? AND contact_id = ? LIMIT 1`;

  const Values = [tenant_id, contact_id];

  try {
    const [result] = await db.sequelize.query(Query, { replacements: Values });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updateLiveChatTimestampService = async (tenant_id, contact_id) => {
  const Query = `
    UPDATE ${tableNames?.LIVECHAT} 
    SET last_message_at = NOW() 
    WHERE tenant_id = ? AND contact_id = ?`;

  const Values = [tenant_id, contact_id];

  try {
    const [result] = await db.sequelize.query(Query, { replacements: Values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const startLiveChatCleanupService = () => {
  cron.schedule("*/1 * * * *", async () => {
    console.log("livechat cleaup started");

    const Query = `
    DELETE FROM ${tableNames?.LIVECHAT} 
    WHERE last_message_at < NOW() - INTERVAL 24 HOUR`;

    try {
      const [result] = await db.sequelize.query(Query);
      return result;
    } catch (err) {
      throw err;
    }
  });
};

export const getLiveChatListService = async (tenant_id) => {
  const dataQuery = `
    SELECT
      m.contact_id,
      c.phone,
      c.name,
      m.message,
      m.message_type,
      m.created_at AS last_message_at,
      lc.assigned_admin_id,
      agent.username AS assigned_agent_name,
      c.is_ai_silenced,
      COALESCE(uc.cnt, 0) AS unread_count
    FROM messages m
    INNER JOIN (
      SELECT
        contact_id,
        MAX(created_at) AS last_message_time
      FROM messages
      WHERE tenant_id = ? AND is_deleted = false
      GROUP BY contact_id
    ) lm
      ON m.contact_id = lm.contact_id
     AND m.created_at = lm.last_message_time
    JOIN contacts c
      ON c.contact_id = m.contact_id
    INNER JOIN ${tableNames.LIVECHAT} lc
      ON lc.contact_id = m.contact_id
     AND lc.tenant_id = ?
    LEFT JOIN ${tableNames.TENANT_USERS} agent
      ON agent.tenant_user_id = lc.assigned_admin_id
     AND agent.is_deleted = false
    LEFT JOIN (
      SELECT contact_id, COUNT(*) AS cnt
      FROM ${tableNames.MESSAGES}
      WHERE tenant_id = ? AND seen = false AND sender = 'user' AND is_deleted = false
      GROUP BY contact_id
    ) uc ON uc.contact_id = m.contact_id
    WHERE m.tenant_id = ?
    ORDER BY m.created_at DESC
    LIMIT 200
  `;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id, tenant_id, tenant_id, tenant_id],
    });

    return rows;
  } catch (err) {
    throw err;
  }
};

export const getHistoryChatListService = async (tenant_id) => {
  const dataQuery = `
    SELECT
      c.contact_id,
      c.phone,
      c.name,
      c.is_ai_silenced,
      m.message,
      m.created_at AS last_message_at,
      COALESCE(uc.cnt, 0) AS unread_count
    FROM messages m
    INNER JOIN (
      SELECT
        contact_id,
        MAX(created_at) AS last_message_time
      FROM messages
      WHERE tenant_id = ? AND is_deleted = false
      GROUP BY contact_id
    ) lm
      ON m.contact_id = lm.contact_id
     AND m.created_at = lm.last_message_time
    JOIN contacts c
      ON c.contact_id = m.contact_id
    LEFT JOIN ${tableNames.LIVECHAT} lc
      ON lc.contact_id = c.contact_id
     AND lc.tenant_id = ?
    LEFT JOIN (
      SELECT contact_id, COUNT(*) AS cnt
      FROM ${tableNames.MESSAGES}
      WHERE tenant_id = ? AND seen = false AND sender = 'user' AND is_deleted = false
      GROUP BY contact_id
    ) uc ON uc.contact_id = c.contact_id
    WHERE m.tenant_id = ?
      AND lc.contact_id IS NULL
    ORDER BY m.created_at DESC
    LIMIT 200
  `;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id, tenant_id, tenant_id, tenant_id],
    });

    return {
      chats: rows,
    };
  } catch (err) {
    throw err;
  }
};

// ─── AGENT ASSIGNMENT SERVICES ───────────────────────────────────────────────

/**
 * Agent self-claims a live chat (sets assigned_admin_id to the caller's user id)
 */
export const claimLiveChatService = async (tenant_id, contact_id, agent_id) => {
  const Query = `
    UPDATE ${tableNames.LIVECHAT}
    SET assigned_admin_id = ?
    WHERE tenant_id = ? AND contact_id = ?
  `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [agent_id, tenant_id, contact_id],
    });

    // ─── SYNC WITH LEADS ─────────────────────────────────────────────────────
    const syncQuery = `UPDATE ${tableNames.LEADS} SET assigned_to = ? WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false`;
    await db.sequelize.query(syncQuery, {
      replacements: [agent_id, tenant_id, contact_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

/**
 * Admin assigns a specific agent to a live chat
 */
export const assignAgentToLiveChatService = async (
  tenant_id,
  contact_id,
  agent_id,
) => {
  const Query = `
    UPDATE ${tableNames.LIVECHAT}
    SET assigned_admin_id = ?
    WHERE tenant_id = ? AND contact_id = ?
  `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [agent_id, tenant_id, contact_id],
    });

    // ─── SYNC WITH LEADS ─────────────────────────────────────────────────────
    const syncQuery = `UPDATE ${tableNames.LEADS} SET assigned_to = ? WHERE tenant_id = ? AND contact_id = ? AND is_deleted = false`;
    await db.sequelize.query(syncQuery, {
      replacements: [agent_id, tenant_id, contact_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

/**
 * Get all active users (agents/staff/doctors/admins) for the assign dropdown
 */
export const getAgentListService = async (tenant_id) => {
  const Query = `
    SELECT tenant_user_id, username, role, profile
    FROM ${tableNames.TENANT_USERS}
    WHERE tenant_id = ?
      AND role IN ('agent', 'staff', 'doctor', 'tenant_admin')
      AND is_deleted = false
      AND status = 'active'
    ORDER BY username ASC
  `;

  try {
    const [rows] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });
    return rows;
  } catch (err) {
    throw err;
  }
};
