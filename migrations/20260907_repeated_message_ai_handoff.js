/**
 * Migration: Repeated User Message → AI Handoff
 *
 * Additive and backward-compatible:
 *   - Adds repetition-tracking + pause-metadata columns to `contacts`.
 *     `is_ai_silenced` is NOT touched, so already-silenced contacts stay silenced.
 *   - Creates the durable `ai_handoff_events` outbox table.
 *
 * Idempotent (each column/table is created only if absent).
 * Down removes ONLY the newly introduced fields/table.
 *
 * Run (from invictus-chatbot/):
 *   node migrations/20260907_repeated_message_ai_handoff.js
 *   node migrations/20260907_repeated_message_ai_handoff.js down
 */
import db from "../src/database/index.js";

const CONTACT_COLUMNS = [
  {
    name: "repeat_message_hash",
    ddl: `ALTER TABLE contacts ADD COLUMN repeat_message_hash VARCHAR(64) NULL
            COMMENT 'SHA-256 of the normalized text of the current inbound repetition streak'`,
  },
  {
    name: "repeat_message_count",
    ddl: `ALTER TABLE contacts ADD COLUMN repeat_message_count INT NOT NULL DEFAULT 0
            COMMENT 'Consecutive matching inbound user text messages in the current streak'`,
  },
  {
    name: "repeat_last_received_at",
    ddl: `ALTER TABLE contacts ADD COLUMN repeat_last_received_at DATETIME NULL
            COMMENT 'Server reception time of the last matching message in the streak'`,
  },
  {
    name: "ai_pause_reason",
    ddl: `ALTER TABLE contacts ADD COLUMN ai_pause_reason VARCHAR(48) NULL
            COMMENT 'manual | repeated_user_message | repeated_ai_reply (NULL = legacy manual silence)'`,
  },
  {
    name: "ai_paused_at",
    ddl: `ALTER TABLE contacts ADD COLUMN ai_paused_at DATETIME NULL`,
  },
  {
    name: "ai_reply_epoch",
    ddl: `ALTER TABLE contacts ADD COLUMN ai_reply_epoch INT NOT NULL DEFAULT 0
            COMMENT 'Fencing token — bumped on every pause and resume transition'`,
  },
];

const columnExists = async (table, name) => {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :name`,
    { replacements: { table, name } },
  );
  return Number(rows?.[0]?.n || 0) > 0;
};

const tableExists = async (name) => {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = :name`,
    { replacements: { name } },
  );
  return Number(rows?.[0]?.n || 0) > 0;
};

const up = async () => {
  for (const c of CONTACT_COLUMNS) {
    if (!(await columnExists("contacts", c.name))) {
      await db.sequelize.query(c.ddl);
      console.log(`[MIGRATION] contacts.${c.name} added`);
    }
  }

  if (!(await tableExists("ai_handoff_events"))) {
    await db.sequelize.query(`
      CREATE TABLE ai_handoff_events (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        tenant_id VARCHAR(255) NOT NULL,
        contact_id VARCHAR(255) NOT NULL,
        ai_reply_epoch INT NOT NULL,
        trigger_message_id VARCHAR(255) NULL,
        reason VARCHAR(48) NOT NULL DEFAULT 'repeated_user_message',
        notice_text TEXT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'pending',
        provider_message_id VARCHAR(255) NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        last_attempt_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_handoff_pause_epoch (tenant_id, contact_id, ai_reply_epoch),
        KEY idx_handoff_status (status, last_attempt_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("[MIGRATION] ai_handoff_events table created");
  }
};

const down = async () => {
  if (await tableExists("ai_handoff_events")) {
    await db.sequelize.query("DROP TABLE ai_handoff_events");
    console.log("[MIGRATION] ai_handoff_events dropped");
  }
  for (const c of [...CONTACT_COLUMNS].reverse()) {
    if (await columnExists("contacts", c.name)) {
      await db.sequelize.query(`ALTER TABLE contacts DROP COLUMN ${c.name}`);
      console.log(`[MIGRATION] contacts.${c.name} dropped`);
    }
  }
};

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  console.log(`[MIGRATION] Running ${direction.toUpperCase()} repeated_message_ai_handoff...`);
  try {
    if (direction === "down") await down();
    else await up();
    console.log("[MIGRATION] Done.");
  } catch (err) {
    console.error("[MIGRATION] FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
};

run();
