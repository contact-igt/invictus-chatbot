import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const getConversationMemory = async (tenant_id, phone, limit = 10) => {
  if (!phone) return [];

  const [rows] = await db.sequelize.query(
    `
    SELECT sender, message
    FROM ${tableNames.MESSAGES}
    WHERE phone = ? AND tenant_id = ?
    ORDER BY created_at DESC
    LIMIT ?
    `,
    {
      replacements: [phone, tenant_id, limit],
    },
  );

  // Return oldest → newest
  return rows.reverse();
};
