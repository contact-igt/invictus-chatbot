/**
 * Migration: day-level doctor availability settings
 *
 * Run manually (from Backend/):
 *   node migrations/20260516_doctor_availability_days.js
 *   node migrations/20260516_doctor_availability_days.js down
 */

import db from "../src/database/index.js";

const UP = `
  CREATE TABLE IF NOT EXISTS doctor_availability_days (
    id INT NOT NULL AUTO_INCREMENT,
    tenant_id VARCHAR(255) NOT NULL,
    doctor_id VARCHAR(255) NOT NULL,
    day_of_week ENUM('monday','tuesday','wednesday','thursday','friday','saturday','sunday') NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    slot_duration INT NOT NULL DEFAULT 15,
    use_default_duration TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_doctor_availability_day (tenant_id, doctor_id, day_of_week),
    KEY idx_availability_day_doctor (doctor_id),
    KEY idx_availability_day_tenant (tenant_id)
  );

  INSERT INTO doctor_availability_days
    (tenant_id, doctor_id, day_of_week, enabled, slot_duration, use_default_duration, created_at, updated_at)
  SELECT
    da.tenant_id,
    da.doctor_id,
    da.day_of_week,
    1,
    15,
    1,
    NOW(),
    NOW()
  FROM doctor_availability da
  GROUP BY da.tenant_id, da.doctor_id, da.day_of_week
  ON DUPLICATE KEY UPDATE
    enabled = VALUES(enabled),
    slot_duration = COALESCE(slot_duration, VALUES(slot_duration)),
    use_default_duration = COALESCE(use_default_duration, VALUES(use_default_duration)),
    updated_at = NOW();
`;

const DOWN = `
  DROP TABLE IF EXISTS doctor_availability_days;
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  