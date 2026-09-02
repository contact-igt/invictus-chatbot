/**
 * BUG-3 / Phase 7 — collapse the duplicate unique indexes on
 * meta_messaging_limit_events that Sequelize `sync({ alter: true })` accreted
 * (reservation_id, reservation_id_2, reservation_id_3, wamid, wamid_2, …).
 *
 * Forward-only. Idempotent. Safe when there are zero duplicates.
 * Never touches PRIMARY or the idx_meta_limit_* indexes.
 *
 * Run: node migrations/20260903_dedupe_meta_limit_unique_indexes.js
 */
import db from "../src/database/index.js";

const TABLE = "meta_messaging_limit_events";
const CANON = {
  reservation_id: "uq_meta_limit_reservation",
  wamid: "uq_meta_limit_wamid",
};

// Unique indexes that consist of EXACTLY the one column (col_count = 1).
const singleColumnUniqueIndexes = async (column) => {
  const [rows] = await db.sequelize.query(
    `SELECT s.index_name AS name
       FROM information_schema.statistics s
       JOIN (
         SELECT index_name, COUNT(*) AS col_count
           FROM information_schema.statistics
          WHERE table_schema = DATABASE() AND table_name = :t
          GROUP BY index_name
       ) c ON c.index_name = s.index_name
      WHERE s.table_schema = DATABASE()
        AND s.table_name = :t
        AND s.column_name = :col
        AND s.non_unique = 0
        AND s.index_name <> 'PRIMARY'
        AND c.col_count = 1
      GROUP BY s.index_name`,
    { replacements: { t: TABLE, col: column } },
  );
  return rows.map((r) => r.name);
};

const indexExists = async (name) => {
  const [rows] = await db.sequelize.query(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = :t AND index_name = :n LIMIT 1`,
    { replacements: { t: TABLE, n: name } },
  );
  return rows.length > 0;
};

const run = async () => {
  try {
    for (const [column, canonical] of Object.entries(CANON)) {
      const existing = await singleColumnUniqueIndexes(column);

      // 1. ensure the canonical index exists (create if none at all, or if the
      //    only ones present are the accreted duplicates).
      if (!existing.includes(canonical)) {
        await db.sequelize.query(
          `ALTER TABLE ${TABLE} ADD UNIQUE INDEX ${canonical} (${column})`,
        );
        console.log(`[MIGRATION] created ${canonical}`);
      }

      // 2. drop every OTHER single-column unique index on this column.
      const toDrop = (await singleColumnUniqueIndexes(column)).filter(
        (n) => n !== canonical,
      );
      for (const name of toDrop) {
        await db.sequelize.query(`ALTER TABLE ${TABLE} DROP INDEX \`${name}\``);
        console.log(`[MIGRATION] dropped duplicate ${name}`);
      }
    }

    // sanity report
    for (const [column, canonical] of Object.entries(CANON)) {
      const left = await singleColumnUniqueIndexes(column);
      console.log(
        `[MIGRATION] ${column}: unique single-col indexes now = [${left.join(", ")}] (canonical ${canonical} present: ${await indexExists(canonical)})`,
      );
    }

    console.log("[MIGRATION] UP completed: dedupe meta_messaging_limit_events unique indexes");
    process.exit(0);
  } catch (error) {
    console.error("[MIGRATION] FAILED:", error.message);
    process.exit(1);
  }
};

run();
