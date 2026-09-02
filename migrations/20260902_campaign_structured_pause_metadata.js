/**
 * FIX 3 — structured campaign pause metadata.
 *
 * Auto-resume must NOT depend on parsing the free-text `paused_reason`. This adds
 * typed columns so the resume scheduler can safely target only automatically
 * resumable pauses (META_LOCAL_CAPACITY) and never touch MANUAL / restriction /
 * auth pauses.
 *
 * Forward-only, idempotent (each column is added only if absent).
 * Run: node migrations/20260902_campaign_structured_pause_metadata.js
 *      node migrations/20260902_campaign_structured_pause_metadata.js down
 */
import db from "../src/database/index.js";

const COLUMNS = [
  {
    name: "pause_type",
    ddl: `ALTER TABLE whatsapp_campaigns
            ADD COLUMN pause_type VARCHAR(48) NULL
            COMMENT 'META_LOCAL_CAPACITY | META_SPAM_RESTRICTION | META_ACCOUNT_RESTRICTION | META_AUTH_CONFIG | MANUAL'`,
  },
  {
    name: "pause_code",
    ddl: `ALTER TABLE whatsapp_campaigns
            ADD COLUMN pause_code VARCHAR(32) NULL
            COMMENT 'Meta error code or LOCAL_META_TIER_LIMIT'`,
  },
  {
    name: "paused_at",
    ddl: `ALTER TABLE whatsapp_campaigns ADD COLUMN paused_at DATETIME NULL`,
  },
  {
    name: "next_retry_at",
    ddl: `ALTER TABLE whatsapp_campaigns
            ADD COLUMN next_retry_at DATETIME NULL
            COMMENT 'When the auto-resume scheduler may recheck a META_LOCAL_CAPACITY pause'`,
  },
];

const columnExists = async (name) => {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'whatsapp_campaigns'
        AND column_name = :name`,
    { replacements: { name } },
  );
  return Number(rows?.[0]?.n || 0) > 0;
};

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  try {
    if (direction === "down") {
      for (const c of COLUMNS) {
        if (await columnExists(c.name)) {
          await db.sequelize.query(
            `ALTER TABLE whatsapp_campaigns DROP COLUMN ${c.name}`,
          );
        }
      }
    } else {
      for (const c of COLUMNS) {
        if (!(await columnExists(c.name))) {
          await db.sequelize.query(c.ddl);
        }
      }
      await db.sequelize.query(
        `CREATE INDEX idx_campaign_pause_retry
           ON whatsapp_campaigns (status, pause_type, next_retry_at)`,
      ).catch(() => {}); // index may already exist
    }
    console.log(`[MIGRATION] ${direction.toUpperCase()} completed: campaign structured pause metadata`);
    process.exit(0);
  } catch (error) {
    console.error(`[MIGRATION] ${direction.toUpperCase()} failed:`, error.message);
    process.exit(1);
  }
};

run();
