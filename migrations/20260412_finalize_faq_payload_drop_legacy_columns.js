/**
 * Migration: Finalize FAQ payload-only schema.
 *
 * Goals:
 * 1) Backfill faq_payload from legacy question/answer when needed.
 * 2) Remove duplicate rows by faq_review_id (keep latest row).
 * 3) Ensure unique protection on faq_review_id.
 * 4) Drop legacy question/answer columns from faq_knowledge_source.
 *
 * Run manually:
 *   node migrations/20260412_finalize_faq_payload_drop_legacy_columns.js
 */

import db from "../src/database/index.js";

const TABLE = "faq_knowledge_source";

const tableExists = async () => {
  const [rows] = await db.sequelize.query(`SHOW TABLES LIKE ?`, {
    replacements: [TABLE],
  });
  return rows.length > 0;
};

const columnExists = async (columnName) => {
  const [rows] = await db.sequelize.query(
    `SHOW COLUMNS FROM ${TABLE} LIKE ?`,
    { replacements: [columnName] },
  );
  return rows.length > 0;
};

const indexExists = async (indexName) => {
  const [rows] = await db.sequelize.query(
    `SHOW INDEX FROM ${TABLE} WHERE Key_name = ?`,
    { replacements: [indexName] },
  );
  return rows.length > 0;
};

async function run() {
  try {
    const exists = await tableExists();
    if (!exists) {
      console.log(`[MIGRATION] ${TABLE} table not found. Nothing to do.`);
      return;
    }

    const hasQuestion = await columnExists("question");
    const hasAnswer = await columnExists("answer");

    if (hasQuestion && hasAnswer) {
      console.log("[MIGRATION] Backfilling faq_payload from legacy question/answer...");
      const [, meta] = await db.sequelize.query(
        `UPDATE ${TABLE}
         SET faq_payload = JSON_OBJECT('question', question, 'answer', answer)
         WHERE faq_payload IS NULL`,
      );
      const affected = meta?.affectedRows ?? meta;
      console.log(`[MIGRATION] Backfill complete — ${affected} row(s) updated.`);
    } else {
      console.log("[MIGRATION] Legacy columns already absent. Skipping backfill from legacy fields.");
    }

    console.log("[MIGRATION] Removing duplicate faq_review_id rows (keeping latest id)...");
    const [, dedupeMeta] = await db.sequelize.query(
      `DELETE k1
       FROM ${TABLE} k1
       INNER JOIN ${TABLE} k2
         ON k1.faq_review_id = k2.faq_review_id
        AND k1.id < k2.id`,
    );
    const deduped = dedupeMeta?.affectedRows ?? dedupeMeta;
    console.log(`[MIGRATION] Dedupe complete — ${deduped} duplicate row(s) removed.`);

    const hasUniqueFaqReview = await indexExists("uq_faq_review");
    if (!hasUniqueFaqReview) {
      console.log("[MIGRATION] Adding unique key uq_faq_review on faq_review_id...");
      await db.sequelize.query(
        `ALTER TABLE ${TABLE}
         ADD UNIQUE KEY uq_faq_review (faq_review_id)`,
      );
      console.log("[MIGRATION] Unique key uq_faq_review added.");
    } else {
      console.log("[MIGRATION] Unique key uq_faq_review already exists.");
    }

    const dropParts = [];
    if (await columnExists("question")) dropParts.push("DROP COLUMN question");
    if (await columnExists("answer")) dropParts.push("DROP COLUMN answer");

    if (dropParts.length) {
      console.log("[MIGRATION] Dropping legacy columns:", dropParts.join(", "));
      await db.sequelize.query(`ALTER TABLE ${TABLE} ${dropParts.join(", ")}`);
      console.log("[MIGRATION] Legacy columns dropped successfully.");
    } else {
      console.log("[MIGRATION] Legacy columns already removed.");
    }

    console.log("[MIGRATION] ✓ FAQ payload-only schema finalization completed.");
  } catch (err) {
    console.error("[MIGRATION] Failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
}

run();
