/**
 * Migration: Create faq_knowledge_source table and backfill existing
 * published FAQ entries.
 *
 * Run manually:
 *   node migrations/20260410_create_faq_knowledge_source.js
 */

import db from "../src/database/index.js";

const UP = `
  CREATE TABLE IF NOT EXISTS faq_knowledge_source (
    id              INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id       VARCHAR(255) NOT NULL,
    source_id       INT          NOT NULL COMMENT 'FK → knowledge_sources.id (Doctor FAQ Knowledge master)',
    faq_review_id   INT          NOT NULL COMMENT 'FK → faq_reviews.id',
    question        TEXT         NOT NULL,
    answer          TEXT         NOT NULL,
    is_active       TINYINT(1)   NOT NULL DEFAULT 1,
    updated_by      VARCHAR(255)          DEFAULT NULL,
    updated_at      DATETIME              DEFAULT NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_faq_review (faq_review_id),
    INDEX idx_tenant_active (tenant_id, is_active)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const BACKFILL = `
  INSERT INTO faq_knowledge_source
    (tenant_id, source_id, faq_review_id, question, answer, is_active, created_at)
  SELECT
    fr.tenant_id,
    ks.id           AS source_id,
    fr.id           AS faq_review_id,
    fr.question,
    fr.doctor_answer AS answer,
    fr.is_active,
    fr.answered_at  AS created_at
  FROM faq_reviews fr
  INNER JOIN knowledge_sources ks
    ON ks.tenant_id = fr.tenant_id AND ks.type = 'faq'
  WHERE fr.status = 'published'
    AND fr.doctor_answer IS NOT NULL
    AND fr.doctor_answer != ''
  ON DUPLICATE KEY UPDATE
    answer     = VALUES(answer),
    is_active  = VALUES(is_active),
    updated_at = NOW();
`;

async function run() {
  try {
    console.log("[MIGRATION] Creating faq_knowledge_source table…");
    await db.sequelize.query(UP);
    console.log("[MIGRATION] Table created (or already exists).");

    console.log("[MIGRATION] Backfilling existing published FAQs…");
    const [, meta] = await db.sequelize.query(BACKFILL);
    const affected = meta?.affectedRows ?? meta;
    console.log(`[MIGRATION] Backfill complete — ${affected} row(s) affected.`);
  } catch (err) {
    console.error("[MIGRATION] Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
}

run();
