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
    console.log(`[MIGRATION] ${INDEX} already exists on ${TABLE}.`);
    return;
  }
  await db.sequelize.query(
    `ALTER TABLE ${TABLE} ADD UNIQUE KEY ${INDEX} (message_id)`,
  );
  console.log(`[MIGRATION] Added ${INDEX} on ${TABLE}(message_id).`);
};

const down = async () => {
  if (!(await indexExists())) {
    console.log(`[MIGRATION] ${INDEX} does not exist on ${TABLE}.`);
    return;
  }
  await db.sequelize.query(`ALTER TABLE ${TABLE} DROP INDEX ${INDEX}`);
  console.log(`[MIGRATION] Dropped ${INDEX} from ${TABLE}.`);
};

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  console.log(`[MIGRATION] Running ${direction.toUpperCase()} processed message unique index...`);
  try {
    if (direction === "down") await down();
    else await up();
    console.log("[MIGRATION] Done.");
  } catch (err) {
    console.error("[MIGRATION] FAILED:", err.message);
    process.exit(1);
  } finally {
    await db.sequelize.close();
  }
};

run();
