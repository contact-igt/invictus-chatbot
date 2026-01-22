import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const getConversationMemory = async (tenant_id, phone) => {
  if (!phone) return [];

  const [rows] = await db.sequelize.query(
    `
    SELECT sender, message , created_at
    FROM ${tableNames.MESSAGES}
    WHERE phone = ? AND tenant_id = ?
    ORDER BY created_at DESC
    `,
    {
      replacements: [phone, tenant_id],
    },
  );

  // Return oldest → newest
  return rows.reverse();
};
