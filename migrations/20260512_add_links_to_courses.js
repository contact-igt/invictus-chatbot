/**
 * Migration: Add registration_link and meeting_link to courses table
 *
 * Run manually:
 *   node migrations/20260512_add_links_to_courses.js
 */

import db from "../src/database/index.js";

const UP = `
  ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS registration_link VARCHAR(1024) NULL COMMENT 'Optional registration URL for the course' AFTER description,
  ADD COLUMN IF NOT EXISTS meeting_link VARCHAR(1024) NULL COMMENT 'Optional meeting/join URL for the course' AFTER registration_link;
`;

const DOWN = `
  ALTER TABLE courses
  DROP COLUMN IF EXISTS meeting_link,
  DROP COLUMN IF EXISTS registration_link;
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  console.log(`[MIGRATION] Running ${direction.toUpperCase()}...`);
  try {
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
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
