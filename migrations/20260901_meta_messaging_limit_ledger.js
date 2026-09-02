/**
 * Adds a delivery-confirmed, portfolio-level ledger for Meta messaging limits.
 * Run: node migrations/20260901_meta_messaging_limit_ledger.js
 */
import db from "../src/database/index.js";

// meta_info_synced_at may already exist (Sequelize `sync({alter:true})` or an
// earlier migration), so add it only when missing — a duplicate-column error
// would otherwise abort the whole migration.
const ensureSyncedAtColumn = async () => {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'whatsapp_accounts'
        AND column_name = 'meta_info_synced_at'`,
  );
  const exists = Number(rows?.[0]?.n || 0) > 0;
  if (!exists) {
    await db.sequelize.query(
      `ALTER TABLE whatsapp_accounts
         ADD COLUMN meta_info_synced_at DATETIME NULL
         COMMENT 'Last successful quality/tier refresh from Meta'`,
    );
  }
};

const UP = [
  `CREATE TABLE IF NOT EXISTS meta_messaging_limit_events (
     id BIGINT NOT NULL AUTO_INCREMENT,
     reservation_id VARCHAR(36) NOT NULL,
     tenant_id VARCHAR(255) NOT NULL,
     waba_id VARCHAR(255) NOT NULL,
     phone_number_id VARCHAR(255) NOT NULL,
     recipient_phone VARCHAR(32) NOT NULL,
     template_name VARCHAR(255) NULL,
     wamid VARCHAR(255) NULL,
     status ENUM('reserved','sent','delivered','read','failed') NOT NULL DEFAULT 'reserved',
     qualifies TINYINT(1) NOT NULL DEFAULT 1,
     sent_at DATETIME NOT NULL,
     delivered_at DATETIME NULL,
     created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uq_meta_limit_reservation (reservation_id),
     UNIQUE KEY uq_meta_limit_wamid (wamid),
     KEY idx_meta_limit_waba_sent (waba_id, qualifies, sent_at),
     KEY idx_meta_limit_waba_delivered (waba_id, qualifies, delivered_at),
     KEY idx_meta_limit_recipient (waba_id, recipient_phone, sent_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const DOWN = [
  "DROP TABLE IF EXISTS meta_messaging_limit_events",
  // meta_info_synced_at is left in place on down — it is also declared on the
  // model and other code paths read it.
];

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  try {
    if (direction === "up") await ensureSyncedAtColumn();
    for (const sql of direction === "down" ? DOWN : UP) {
      await db.sequelize.query(sql);
    }
    console.log(`[MIGRATION] ${direction.toUpperCase()} completed: Meta messaging limit ledger`);
    process.exit(0);
  } catch (error) {
    console.error(`[MIGRATION] ${direction.toUpperCase()} failed:`, error.message);
    process.exit(1);
  }
};

run();
