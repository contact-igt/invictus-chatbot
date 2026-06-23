/**
 * Migration: Add last_dispatch_enqueued_at column to whatsapp_campaigns
 *
 * Adds tracking for when campaign dispatch was last enqueued, used by finalization
 * race condition guards (B-3) to prevent multiple finalization paths from conflicting.
 *
 * Run manually (from Backend/):
 *   node migrations/20260617_add_last_dispatch_enqueued_at.js
 *   node migrations/20260617_add_last_dispatch_enqueued_at.js down
 */

import db from "../src/database/index.js";

const UP = `
  ALTER TABLE whatsapp_campaigns
  ADD COLUMN last_dispatch_enqueued_at DATETIME NULL COMMENT 'Timestamp when campaign dispatch was last enqueued (for finalization race guards)',
  ADD INDEX idx_campaigns_status_last_dispatch_enqueued (status, last_dispatch_enqueued_at);
`;

const DOWN = `
  ALTER TABLE whatsapp_campaigns
  DROP INDEX idx_campaigns_status_last_dispatch_enqueued,
  DROP COLUMN last_dispatch_enqueued_at;
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;

  try {
    await db.sequelize.query(sql);
    console.log(`✅ Migration ${direction} successful`);
    process.exit(0);
  } catch (error) {
    console.error(`❌ Migration ${direction} failed:`, error.message);
    process.exit(1);
  }
};

run();
