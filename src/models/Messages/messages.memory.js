import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const getConversationMemory = async (tenant_id, phone, contact_id = null) => {
  if (!phone && !contact_id) return [];

  let whereClause = "tenant_id = ?";
  let replacements = [tenant_id];

  if (contact_id) {
    whereClause += " AND contact_id = ?";
    replacements.push(contact_id);
  } else {
    // Normalize phone to last 10 digits for consistent lookup in 'messages' table
    const cleanPhone = phone.toString().replace(/\D/g, "");
    const suffix = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    whereClause += " AND phone = ?";
    replacements.push(suffix);
  }

  const [rows] = await db.sequelize.query(
    `
    SELECT sender, message, message_type, created_at
    FROM ${tableNames.MESSAGES}
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT 50
    `,
    {
      replacements: replacements,
    },
  );

  // Return oldest → newest
  return rows.reverse();
};
