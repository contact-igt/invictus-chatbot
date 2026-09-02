/**
 * R-3 hardening — durable store for delivery/read/failed webhooks that arrive
 * before the ledger `wamid` correlation is committed. A bounded cron retries
 * these; unresolved rows are logged after exhausting attempts.
 *
 * Forward-only, idempotent.
 * Run: node migrations/20260904_meta_unmatched_status_events.js
 */
import db from "../src/database/index.js";

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  try {
    if (direction === "down") {
      await db.sequelize.query(`DROP TABLE IF EXISTS meta_unmatched_status_events`);
    } else {
      await db.sequelize.query(`
        CREATE TABLE IF NOT EXISTS meta_unmatched_status_events (
          id BIGINT NOT NULL AUTO_INCREMENT,
          wamid VARCHAR(255) NOT NULL,
          status ENUM('delivered','read','failed') NOT NULL,
          meta_timestamp DATETIME NULL,
          payload TEXT NULL,
          retry_count INT NOT NULL DEFAULT 0,
          next_retry_at DATETIME NULL,
          resolved_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_meta_unmatched_wamid (wamid),
          KEY idx_meta_unmatched_pending (resolved_at, next_retry_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
    console.log(`[MIGRATION] ${direction.toUpperCase()} completed: meta_unmatched_status_events`);
    process.exit(0);
  } catch (error) {
    console.error(`[MIGRATION] ${direction.toUpperCase()} failed:`, error.message);
    process.exit(1);
  }
};

run();
