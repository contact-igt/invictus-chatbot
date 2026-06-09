/**
 * Migration: Ensure inbound webhook message IDs are globally unique
 *
 * Run manually (from Backend/):
 *   node migrations/20260521_processed_messages_unique_message_id.js
 *   node migrations/20260521_processed_messages_unique_message_id.js down
 */

import db from "../src/database/index.js";

const TABLE = "processed_messages";
const INDEX = "unique_proc_msg_id";

const indexExists = async () => {
  const [rows] = await db.sequelize.query(
    `SHOW INDEX FROM ${TABLE} WHERE Key_name = ?`,
    { replacements: [INDEX] },
  );
  return rows.length > 0;
};

const up = async () => {
  if (await indexExists()) {
    