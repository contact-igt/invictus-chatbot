/**
 * Migration: WhatsApp manage booked appointments flow
 *
 * Run manually (from Backend/):
 *   node migrations/20260519_manage_booked_appointments.js
 *   node migrations/20260519_manage_booked_appointments.js down
 */

import db from "../src/database/index.js";

const UP = `
  ALTER TABLE appointments
    MODIFY COLUMN status ENUM('Pending','Confirmed','Rescheduled','Completed','Cancelled','Expired','Noshow') NOT NULL DEFAULT 'Pending';

  ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS branch_name VARCHAR(255) NULL AFTER status,
    ADD COLUMN IF NOT EXISTS service_name VARCHAR(255) NULL AFTER branch_name,
    ADD COLUMN IF NOT EXISTS slot_id VARCHAR(50) NULL AFTER service_name,
    ADD COLUMN IF NOT EXISTS cancelled_at DATETIME NULL AFTER slot_id,
    ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(30) NULL AFTER cancelled_at;

  CREATE TABLE IF NOT EXISTS appointment_audit_logs (
    id INT NOT NULL AUTO_INCREMENT,
    appointment_id VARCHAR(50) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    action_type ENUM('VIEWED','UPDATED_NAME','UPDATED_PHONE','UPDATED_EMAIL','UPDATED_REASON','RESCHEDULED','CANCELLED') NOT NULL,
    old_value JSON NULL,
    new_value JSON NULL,
    changed_by VARCHAR(30) NOT NULL,
    changed_from VARCHAR(30) NOT NULL DEFAULT 'WHATSAPP',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_appointment_audit_lookup (tenant_id, appointment_id, created_at),
    KEY idx_appointment_audit_action (tenant_id, action_type, created_at)
  );

  CREATE TABLE IF NOT EXISTS manage_appointment_sessions (
    id INT NOT NULL AUTO_INCREMENT,
    session_id VARCHAR(50) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    user_phone VARCHAR(30) NOT NULL,
    contact_id VARCHAR(50) NULL,
    state VARCHAR(50) NOT NULL,
    appointment_count INT NOT NULL DEFAULT 0,
    appointment_ids JSON NULL,
    selected_appointment_id VARCHAR(50) NULL,
    pending_edit_field VARCHAR(30) NULL,
    pending_edit_value JSON NULL,
    selected_date DATE NULL,
    selected_slot_id VARCHAR(100) NULL,
    selected_time VARCHAR(20) NULL,
    selected_doctor_id VARCHAR(50) NULL,
    current_page INT NOT NULL DEFAULT 0,
    status ENUM('ACTIVE','EXPIRED','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
    last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_manage_appointment_session_id (session_id),
    KEY idx_manage_appt_session_user (tenant_id, user_phone, status),
    KEY idx_manage_appt_session_expiry (status, expires_at)
  );

`;

const DOWN = `
  DROP TABLE IF EXISTS manage_appointment_sessions;
  DROP TABLE IF EXISTS appointment_audit_logs;

  ALTER TABLE appointments
    DROP COLUMN IF EXISTS cancelled_by,
    DROP COLUMN IF EXISTS cancelled_at,
    DROP COLUMN IF EXISTS slot_id,
    DROP COLUMN IF EXISTS service_name,
    DROP COLUMN IF EXISTS branch_name;

  UPDATE appointments SET status = 'Pending' WHERE status IN ('Rescheduled','Expired');

  ALTER TABLE appointments
    MODIFY COLUMN status ENUM('Pending','Confirmed','Completed','Cancelled','Noshow') NOT NULL DEFAULT 'Pending';
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  