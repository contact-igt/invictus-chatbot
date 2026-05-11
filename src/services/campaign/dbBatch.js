// Batched DB helpers for campaign workers
// Overwritten to resolve editor save conflict and ensure consistent behavior
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { logger } from "../../utils/logger.js";

export const batchInsertMessages = async (messages) => {
  if (!messages || messages.length === 0) return 0;

  // columns: tenant_id, contact_id, phone_number_id, country_code, phone, wamid, name, sender, sender_id, message, message_type, media_url, media_mime_type, status, template_name, interactive_payload, media_filename
  const cols = [
    "tenant_id",
    "contact_id",
    "phone_number_id",
    "country_code",
    "phone",
    "wamid",
    "name",
    "sender",
    "sender_id",
    "message",
    "message_type",
    "media_url",
    "media_mime_type",
    "status",
    "template_name",
    "interactive_payload",
    "media_filename",
  ];

  const placeholders = messages
    .map(() => `(${cols.map(() => "?").join(",")})`)
    .join(",");

  const values = [];
  for (const m of messages) {
    values.push(
      m.tenant_id || null,
      m.contact_id || null,
      m.phone_number_id || null,
      m.country_code || null,
      m.phone || null,
      m.wamid || null,
      m.name || null,
      m.sender || null,
      m.sender_id || null,
      m.message || null,
      m.message_type || null,
      m.media_url || null,
      m.media_mime_type || null,
      m.status || null,
      m.template_name || null,
      m.interactive_payload || null,
      m.media_filename || null,
    );
  }

  const query = `INSERT IGNORE INTO ${tableNames.MESSAGES} (${cols.join(",")}) VALUES ${placeholders}`;

  try {
    const [result] = await db.sequelize.query(query, { replacements: values });
    // MySQL returns insertId in result; but when inserting many rows, rowsAffected is better
    return result?.affectedRows ?? (Array.isArray(result) ? result[0] : 0);
  } catch (err) {
    logger.error(`[DB-BATCH] batchInsertMessages failed: ${err.message}`);
    throw err;
  }
};

export const batchUpdateRecipientStatuses = async (updates) => {
  if (!updates || updates.length === 0) return 0;

  const tableName = "whatsapp_campaign_recipients";

  // We'll build a CASE statement for status and meta_message_id and error_message
  const ids = updates.map((u) => u.id);
  const idList = ids.map((id) => db.sequelize.escape(id)).join(",");

  const statusCases = updates
    .map(
      (u) =>
        `WHEN ${db.sequelize.escape(u.id)} THEN ${db.sequelize.escape(u.status)}`,
    )
    .join(" ");

  const metaCases = updates
    .map(
      (u) =>
        `WHEN ${db.sequelize.escape(u.id)} THEN ${u.meta_message_id !== undefined && u.meta_message_id !== null ? db.sequelize.escape(u.meta_message_id) : "NULL"}`,
    )
    .join(" ");

  const errorCases = updates
    .map(
      (u) =>
        `WHEN ${db.sequelize.escape(u.id)} THEN ${u.error_message !== undefined && u.error_message !== null ? db.sequelize.escape(u.error_message) : "NULL"}`,
    )
    .join(" ");

  const retryCases = updates
    .map(
      (u) =>
        `WHEN ${db.sequelize.escape(u.id)} THEN ${u.retry_count !== undefined && u.retry_count !== null ? db.sequelize.escape(u.retry_count) : "NULL"}`,
    )
    .join(" ");

  const nextRetryCases = updates
    .map(
      (u) =>
        `WHEN ${db.sequelize.escape(u.id)} THEN ${u.next_retry_at !== undefined && u.next_retry_at !== null ? db.sequelize.escape(u.next_retry_at) : "NULL"}`,
    )
    .join(" ");

  const query = `UPDATE ${tableName} SET
    status = CASE id ${statusCases} END,
    meta_message_id = CASE id ${metaCases} END,
    error_message = CASE id ${errorCases} END,
    retry_count = CASE id ${retryCases} END,
    next_retry_at = CASE id ${nextRetryCases} END
    WHERE id IN (${idList})`;

  try {
    const [result] = await db.sequelize.query(query);
    return result?.affectedRows ?? 0;
  } catch (err) {
    logger.error(
      `[DB-BATCH] batchUpdateRecipientStatuses failed: ${err.message}`,
    );
    throw err;
  }
};

export default {
  batchInsertMessages,
  batchUpdateRecipientStatuses,
};
