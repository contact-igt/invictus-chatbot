/**
 * Migration: Add message tracking to faq_reviews table
 * 
 * Purpose: Link FAQ entries back to their source messages for the
 * "Go to Chat" feature. Stores WhatsApp Message ID (wamid) and local
 * message database ID for traceability.
 *
 * Run manually:
 *   node migrations/20260413_add_message_tracking_to_faq_reviews.js
 */

import db from "../src/database/index.js";

const UP = `
  ALTER TABLE faq_reviews
  ADD COLUMN IF NOT EXISTS wamid VARCHAR(255) COMMENT 'WhatsApp Message ID from Meta API (unique per message)' AFTER session_id,
  ADD COLUMN IF NOT EXISTS message_id INT COMMENT 'FK → messages.id (local message reference)' AFTER wamid;
  
  CREATE INDEX IF NOT EXISTS idx_faq_wamid ON faq_reviews(wamid);
  CREATE INDEX IF NOT EXISTS idx_faq_message_id ON faq_reviews(message_id);
`;

const DOWN = `
  ALTER TABLE faq_reviews
  DROP INDEX IF EXISTS idx_faq_wamid,
  DROP INDEX IF EXISTS idx_faq_message_id,
  DROP COLUMN IF EXISTS wamid,
  DROP COLUMN IF EXISTS message_id;
`;

async function run() {
  try {
    console.log("[MIGRATION 20260413] Adding message tracking columns to faq_reviews…");
    await db.sequelize.query(UP);
    console.log("[MIGRATION 20260413] Columns added successfully (if not already present).");
  } catch (err) {
    console.error("[MIGRATION 20260413] Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
}

run();
