/**
 * Migration: Add faq_payload JSON column to faq_knowledge_source
 * and backfill from existing question/answer columns.
 *
 * This enables storing FAQ Q+A as a single JSON object for reliable
 * question→answer mapping in AI retrieval, while maintaining backward
 * compatibility with legacy question/answer columns during rollout.
 *
 * Run manually:
 *   node migrations/20260411_add_faq_payload_to_faq_knowledge_source.js
 */

import db from "../src/database/index.js";

const ADD_COLUMN = `
  ALTER TABLE faq_knowledge_source
  ADD COLUMN faq_payload JSON DEFAULT NULL COMMENT 'Unified Q+A storage: {question, answer}'
  AFTER answer;
`;

const BACKFILL = `
  UPDATE faq_knowledge_source
  SET faq_payload = JSON_OBJECT(
    'question', question,
    'answer', answer
  )
  WHERE faq_payload IS NULL;
`;

async function run() {
  try {
    console.log("[MIGRATION] Adding faq_payload JSON column to faq_knowledge_source…");
    await db.sequelize.query(ADD_COLUMN);
    console.log("[MIGRATION] Column added successfully.");

    console.log("[MIGRATION] Backfilling existing FAQ rows with JSON payload…");
    const [, meta] = await db.sequelize.query(BACKFILL);
    const affected = meta?.affectedRows ?? meta;
    console.log(`[MIGRATION] Backfill complete — ${affected} row(s) updated.`);

    console.log("[MIGRATION] ✓ Migration successful. Old question/answer columns preserved for rollout safety.");
  } catch (err) {
    console.error("[MIGRATION] Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
}

run();
