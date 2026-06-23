/**
 * Migration: add default-duration flag on doctor_availability_days
 *
 * Run manually (from backend/):
 *   node migrations/20260525_doctor_availability_day_default_duration_flag.js
 *   node migrations/20260525_doctor_availability_day_default_duration_flag.js down
 */

import db from "../src/database/index.js";

const UP = `
  ALTER TABLE doctor_availability_days
  ADD COLUMN use_default_duration TINYINT(1) NOT NULL DEFAULT 1 AFTER slot_duration;

  UPDATE doctor_availability_days
  SET use_default_duration = CASE
    WHEN slot_duration = 15 THEN 1
    ELSE 0
  END;
`;

const DOWN = `
  ALTER TABLE doctor_availability_days
  DROP COLUMN use_default_duration;
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  