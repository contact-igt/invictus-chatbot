import { tableNames } from "../../database/tableName.js";
import db from "../../database/index.js";
import cron from "node-cron";

export const createLiveChatService = async (tenant_id, contact_id) => {
  const Query = ` INSERT INTO ${tableNames?.LIVECHAT} (tenant_id, contact_id, last_message_at) VALUES (?,?,NOW())`;

  const Values = [tenant_id, contact_id];

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
  const Query = `
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
      ON c.id = m.contact_id
    INNER JOIN ${tableNames.LIVECHAT} lc
      ON lc.contact_id = m.contact_id
     AND lc.tenant_id = ?
    WHERE m.tenant_id = ?
    ORDER BY m.created_at DESC
  `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, tenant_id, tenant_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};
