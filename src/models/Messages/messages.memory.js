import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const getConversationMemory = async (tenant_id, phone) => {
  if (!phone) return [];

  const [rows] = await db.sequelize.query(
    `
    SELECT sender, message, message_type, created_at
    FROM ${tableNames.MESSAGES}
    WHERE phone = ? AND tenant_id = ?
    ORDER BY created_at DESC
    LIMIT 50
    `,
    {
      replacements: [phone, tenant_id],
    },
  );

  // Return oldest → newest
  return rows.reverse();
};
