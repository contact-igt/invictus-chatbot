import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const getConversationMemory = async (phone, limit = 6) => {
  if (!phone) return [];

  const [rows] = await db.sequelize.query(
    `
    SELECT sender, message
    FROM ${tableNames.MESSAGES}
    WHERE phone = ?
    ORDER BY created_at DESC
    LIMIT ?
    `,
    {
      replacements: [phone, limit],
    }
  );

  // Return oldest → newest
  return rows.reverse();
};
