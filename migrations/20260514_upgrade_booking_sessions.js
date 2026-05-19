/**
 * Migration: Upgrade booking_sessions for richer booking/edit flows
 *
 * Run manually (from Backend/):
 *   node migrations/20260514_upgrade_booking_sessions.js
 *   node migrations/20260514_upgrade_booking_sessions.js down
 */

import db from "../src/database/index.js";

const UP = `
  ALTER TABLE booking_sessions
    ADD COLUMN IF NOT EXISTS patient_email VARCHAR(150) NULL COMMENT 'collected this session' AFTER patient_name,
    ADD COLUMN IF NOT EXISTS doctor_specialization VARCHAR(150) NULL COMMENT 'denormalized for confirm summary' AFTER doctor_name,
    ADD COLUMN IF NOT EXISTS edit_target VARCHAR(30) NULL COMMENT 'which field is being edited' AFTER current_step,
    ADD COLUMN IF NOT EXISTS previous_step VARCHAR(30) NULL COMMENT 'where to return after edit completes' AFTER edit_target;

  ALTER TABLE booking_sessions
    ALTER COLUMN current_step SET DEFAULT 'COLLECT_NAME';
`;

const DOWN = `
  ALTER TABLE booking_sessions
    ALTER COLUMN current_step SET DEFAULT 'doctor';

  ALTER TABLE booking_sessions
    DROP COLUMN IF EXISTS previous_step,
    DROP COLUMN IF EXISTS edit_target,
    DROP COLUMN IF EXISTS doctor_specialization,
    DROP COLUMN IF EXISTS patient_email;
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  console.log(`[MIGRATION] Running ${direction.toUpperCase()}...`);
  try {
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.sequelize.query(statement);
      console.log(`[MIGRATION] OK: ${statement.substring(0, 80)}...`);
    }
    console.log("[MIGRATION] Done.");
  } catch (err) {
    console.error("[MIGRATION] FAILED:", err.message);
    process.exit(1);
  } finally {
    await db.sequelize.close();
  }
};

run();
