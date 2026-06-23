/**
 * Migration: add total_messages column on monthly_invoices
 *
 * Fixes a bug where invoices showed "Total Messages: 0" despite a non-zero
 * message cost, because no column ever stored a per-invoice message count.
 *
 * Run manually (from backend/):
 *   node migrations/20260622_add_total_messages_to_monthly_invoices.js
 *   node migrations/20260622_add_total_messages_to_monthly_invoices.js down
 */
import db from "../src/database/index.js";

const UP = `
  ALTER TABLE monthly_invoices
  ADD COLUMN total_messages INT NOT NULL DEFAULT 0 AFTER total_message_cost_inr;
`;

const DOWN = `
  ALTER TABLE monthly_invoices
  DROP COLUMN total_messages;
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;

  try {
    await db.sequelize.query(sql);
    console.log(
      `[MIGRATION] ${direction.toUpperCase()} completed: total_messages on monthly_invoices`,
    );
    process.exit(0);
  } catch (err) {
    console.error(`[MIGRATION] ${direction.toUpperCase()} failed:`, err.message);
    process.exit(1);
  }
};

run();