import db from "../../../database/index.js";
import { tableNames } from "../../../database/tableName.js";

/**
 * Simple email format check (not exhaustive — just prevents saving garbage).
 */
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Handler for [EMAIL_CAPTURE: xxx@yyy.zzz] tag.
 * Auto-saves the user's email to the contact record.
 * Only updates if the contact currently has no email on file.
 */
export const execute = async (payload, context) => {
  const { tenant_id, contact_id } = context;

  if (!payload || !tenant_id || !contact_id) {
    console.log("[EMAIL_CAPTURE] Missing payload or context, skipping.");
    return;
  }

  const email = payload.trim().toLowerCase();

  if (!isValidEmail(email)) {
    console.log(`[EMAIL_CAPTURE] Invalid email "${email}", skipping.`);
    return;
  }

  try {
    // Only update if email is currently empty/null
    const [rows] = await db.sequelize.query(
      `SELECT email FROM ${tableNames.CONTACTS} WHERE contact_id = ? AND tenant_id = ? LIMIT 1`,
      { replacements: [contact_id, tenant_id] },
    );

    if (!rows.length) {
      console.log("[EMAIL_CAPTURE] Contact not found, skipping.");
      return;
    }

    if (rows[0].email) {
      console.log(
        `[EMAIL_CAPTURE] Contact already has email "${rows[0].email}", skipping.`,
      );
      return;
    }

    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACTS} SET email = ? WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [email, contact_id, tenant_id] },
    );

    console.log(
      `[EMAIL_CAPTURE] Saved email "${email}" for contact ${contact_id}`,
    );
  } catch (error) {
    console.error("[EMAIL_CAPTURE] Error saving email:", error.message);
  }
};
