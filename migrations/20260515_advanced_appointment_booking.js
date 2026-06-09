/**
 * Migration: Advanced appointment booking state machine
 *
 * Run manually (from Backend/):
 *   node migrations/20260515_advanced_appointment_booking.js
 *   node migrations/20260515_advanced_appointment_booking.js down
 */

import db from "../src/database/index.js";

const UP = `
  ALTER TABLE booking_sessions
    ADD COLUMN IF NOT EXISTS user_phone VARCHAR(30) NULL AFTER contact_id,
    ADD COLUMN IF NOT EXISTS last_valid_state VARCHAR(50) NULL AFTER current_step,
    ADD COLUMN IF NOT EXISTS draft_json JSON NULL AFTER last_valid_state,
    ADD COLUMN IF NOT EXISTS edit_target VARCHAR(30) NULL AFTER draft_json,
    ADD COLUMN IF NOT EXISTS previous_step VARCHAR(30) NULL AFTER edit_target;

  ALTER TABLE booking_sessions
    MODIFY COLUMN current_step VARCHAR(30) NULL DEFAULT NULL;

  ALTER TABLE booking_sessions
    MODIFY COLUMN status VARCHAR(30) NOT NULL DEFAULT 'active';

  CREATE TABLE IF NOT EXISTS appointment_slots (
    id INT NOT NULL AUTO_INCREMENT,
    tenant_id VARCHAR(255) NOT NULL,
    doctor_id VARCHAR(255) NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time VARCHAR(20) NOT NULL,
    status ENUM('AVAILABLE','LOCKED','BOOKED','EXPIRED') NOT NULL DEFAULT 'LOCKED',
    locked_by_session_id VARCHAR(50) NULL,
    locked_until DATETIME NULL,
    appointment_id VARCHAR(50) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_appointment_slot (tenant_id, doctor_id, appointment_date, appointment_time),
    KEY idx_appointment_slot_lock (locked_by_session_id, status),
    KEY idx_appointment_slot_expiry (status, locked_until)
  );

  CREATE TABLE IF NOT EXISTS appointment_state_logs (
    id INT NOT NULL AUTO_INCREMENT,
    tenant_id VARCHAR(255) NOT NULL,
    user_phone VARCHAR(255) NULL,
    session_id VARCHAR(50) NULL,
    from_state VARCHAR(50) NULL,
    to_state VARCHAR(50) NULL,
    message TEXT NULL,
    reply_id VARCHAR(256) NULL,
    whatsapp_message_id VARCHAR(128) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_appointment_state_session (tenant_id, session_id),
    KEY idx_appointment_state_msg (tenant_id, whatsapp_message_id)
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS appointment_state_logs;
  DROP TABLE IF EXISTS appointment_slots;

  UPDATE booking_sessions
  SET status = CASE
    WHEN status = 'IN_PROGRESS' THEN 'active'
    WHEN status = 'COMPLETED' THEN 'completed'
    WHEN status = 'CANCELLED' THEN 'cancelled'
    WHEN status = 'EXPIRED' THEN 'expired'
    ELSE status
  END;

  ALTER TABLE booking_sessions
    MODIFY COLUMN status ENUM('active','completed','cancelled','expired') NOT NULL DEFAULT 'active';

  ALTER TABLE booking_sessions
    MODIFY COLUMN current_step VARCHAR(30) NOT NULL DEFAULT 'doctor';

  ALTER TABLE booking_sessions
    DROP COLUMN IF EXISTS previous_step,
    DROP COLUMN IF EXISTS edit_target,
    DROP COLUMN IF EXISTS draft_json,
    DROP COLUMN IF EXISTS last_valid_state,
    DROP COLUMN IF EXISTS user_phone;
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  console.log(`[MIGRATION] Running ${direction.toUpperCase()} advanced appointment booking...`);
  try {
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.sequelize.query(statement);
      console.log(`[MIGRATION] OK: ${statement.substring(0, 90)}...`);
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
