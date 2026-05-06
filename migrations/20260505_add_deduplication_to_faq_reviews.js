/**
 * Migration: Add semantic deduplication columns to faq_reviews table
 *
 * Purpose: Enables the FAQ Deduplication & Priority Review System.
 *   - embedding       → stored at FAQ creation time for semantic similarity search
 *   - ask_count       → incremented each time a semantically identical question arrives
 *   - similar_questions → JSON array of alternate phrasings merged into this canonical row
 *
 * Run manually:
 *   node migrations/20260505_add_deduplication_to_faq_reviews.js
 */

import db from "../src/database/index.js";

const UP = `
  ALTER TABLE faq_reviews
  ADD COLUMN IF NOT EXISTS embedding LONGTEXT NULL COMMENT 'JSON embedding vector stored at FAQ creation time' AFTER message_id,
  ADD COLUMN IF NOT EXISTS ask_count INT NOT NULL DEFAULT 1 COMMENT 'How many users asked the same question (semantically)' AFTER embedding,
  ADD COLUMN IF NOT EXISTS similar_questions LONGTEXT NULL COMMENT 'JSON array of alternate phrasings merged into this canonical question' AFTER ask_count,
  ADD COLUMN IF NOT EXISTS potential_duplicate_of INT NULL COMMENT 'FK to faq_reviews.id — soft match (0.65-0.78 similarity)' AFTER similar_questions,
  ADD COLUMN IF NOT EXISTS match_similarity FLOAT NULL COMMENT 'Cosine similarity score when soft-linked' AFTER potential_duplicate_of;

  CREATE INDEX IF NOT EXISTS idx_faq_ask_count ON faq_reviews(tenant_id, ask_count);
`;

const DOWN = `
  ALTER TABLE faq_reviews
  DROP INDEX IF EXISTS idx_faq_ask_count,
  DROP COLUMN IF EXISTS match_similarity,
  DROP COLUMN IF EXISTS potential_duplicate_of,
  DROP COLUMN IF EXISTS embedding,
  DROP COLUMN IF EXISTS ask_count,
  DROP COLUMN IF EXISTS similar_questions;
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
