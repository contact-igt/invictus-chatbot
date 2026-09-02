/**
 * Migration: honest defaults for whatsapp_accounts.quality and .tier
 *
 * Why:
 *   - `quality` was ENUM('GREEN','YELLOW','RED') DEFAULT 'GREEN'. A brand-new
 *     number that Meta has not rated yet showed up as GREEN — a healthy status
 *     with no evidence behind it. We add an 'UNKNOWN' member and default to it.
 *   - `tier` stored a display label ('1K MSG LIMIT') while the rest of the code
 *     keys off Meta's tier constants ('TIER_2K', 'TIER_10K', ...). The mismatch
 *     silently fell back to the 250-user Trial limit everywhere. We normalise the
 *     column to the TIER_* constants and default to 'TIER_NOT_SET'.
 *
 * BUG-4 fix: `syncWabaMetaInfoService` now PERSISTS quality/tier from Meta, so
 * a `GREEN` value may be a genuine Meta rating. This migration therefore only
 * resets rows that have NOT been synced from Meta:
 *     quality IS NULL
 *   OR (quality = 'GREEN' AND meta_info_synced_at IS NULL)
 * Rows with a real Meta rating (meta_info_synced_at set) are left untouched.
 * Legacy-fake `GREEN` rows self-correct on the next sync regardless.
 *
 * Run manually (from backend/):
 *   node migrations/20260901_waba_quality_tier_unknown_defaults.js
 *   node migrations/20260901_waba_quality_tier_unknown_defaults.js down
 */
import db from "../src/database/index.js";

const hasMetaSyncedAt = async () => {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'whatsapp_accounts'
        AND column_name = 'meta_info_synced_at'`,
  );
  return Number(rows?.[0]?.n || 0) > 0;
};

const qualityResetSql = (syncedAtExists) =>
  syncedAtExists
    ? `UPDATE whatsapp_accounts SET quality = 'UNKNOWN'
        WHERE quality IS NULL
           OR (quality = 'GREEN' AND meta_info_synced_at IS NULL)`
    : // column not present yet → nothing has been Meta-synced, safe to blanket-reset
      `UPDATE whatsapp_accounts SET quality = 'UNKNOWN'
        WHERE quality IS NULL OR quality = 'GREEN'`;

const UP = [
  // ── quality ──────────────────────────────────────────────────────────
  `ALTER TABLE whatsapp_accounts
     MODIFY COLUMN quality ENUM('GREEN','YELLOW','RED','UNKNOWN') NULL DEFAULT 'UNKNOWN'`,
  // quality reset SQL is chosen at run time — see qualityResetSql()

  // ── tier ─────────────────────────────────────────────────────────────
  // NOTE: '1K MSG LIMIT' was the old *column default*, never a value written
  // from Meta, so it carries no real information — collapse it (and anything
  // else non-canonical) to TIER_NOT_SET and let the Meta sync fill in the
  // truth. Only the genuinely-higher legacy labels are mapped through, in the
  // unlikely case a row was edited by hand.
  `ALTER TABLE whatsapp_accounts
     MODIFY COLUMN tier VARCHAR(50) NULL DEFAULT 'TIER_NOT_SET'`,
  `UPDATE whatsapp_accounts SET tier = 'TIER_10K'       WHERE tier = '10K MSG LIMIT'`,
  `UPDATE whatsapp_accounts SET tier = 'TIER_100K'      WHERE tier = '100K MSG LIMIT'`,
  `UPDATE whatsapp_accounts SET tier = 'TIER_UNLIMITED' WHERE tier = 'UNLIMITED'`,
  `UPDATE whatsapp_accounts SET tier = 'TIER_NOT_SET'   WHERE tier IS NULL OR tier NOT LIKE 'TIER_%'`,
];

const DOWN = [
  // tier: best-effort restore of the old label format
  `UPDATE whatsapp_accounts SET tier = '10K MSG LIMIT'  WHERE tier = 'TIER_10K'`,
  `UPDATE whatsapp_accounts SET tier = '100K MSG LIMIT' WHERE tier = 'TIER_100K'`,
  `UPDATE whatsapp_accounts SET tier = 'UNLIMITED'      WHERE tier = 'TIER_UNLIMITED'`,
  `UPDATE whatsapp_accounts SET tier = '1K MSG LIMIT'   WHERE tier LIKE 'TIER_%' OR tier IS NULL`,
  `ALTER TABLE whatsapp_accounts
     MODIFY COLUMN tier VARCHAR(50) NULL DEFAULT '1K MSG LIMIT'`,

  // quality: collapse UNKNOWN back to GREEN before shrinking the enum
  `UPDATE whatsapp_accounts SET quality = 'GREEN' WHERE quality = 'UNKNOWN' OR quality IS NULL`,
  `ALTER TABLE whatsapp_accounts
     MODIFY COLUMN quality ENUM('GREEN','YELLOW','RED') NULL DEFAULT 'GREEN'`,
];

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";

  try {
    if (direction === "down") {
      for (const sql of DOWN) await db.sequelize.query(sql);
    } else {
      // [0] = ALTER quality enum
      await db.sequelize.query(UP[0]);
      // quality reset — run-time chosen so a real Meta 'GREEN' is preserved
      await db.sequelize.query(qualityResetSql(await hasMetaSyncedAt()));
      // [1..] = tier statements
      for (const sql of UP.slice(1)) await db.sequelize.query(sql);
    }
    console.log(
      `[MIGRATION] ${direction.toUpperCase()} completed: waba quality/tier defaults`,
    );
    process.exit(0);
  } catch (err) {
    console.error(`[MIGRATION] ${direction.toUpperCase()} failed:`, err.message);
    process.exit(1);
  }
};

run();
