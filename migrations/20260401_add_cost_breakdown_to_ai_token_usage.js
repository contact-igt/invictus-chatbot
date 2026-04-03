/**
 * Migration: Add full cost breakdown columns to ai_token_usage table.
 *
 * New columns:
 *   input_rate       — input rate (USD/1M) used at call time
 *   output_rate      — output rate (USD/1M) used at call time
 *   markup_percent   — platform markup % applied
 *   usd_to_inr_rate  — exchange rate used at call time
 *   base_cost_usd    — raw cost before markup
 *   final_cost_usd   — cost after markup (mirrors estimated_cost)
 *   final_cost_inr   — authoritative INR cost — frontend displays this directly
 *
 * Also widens estimated_cost from DECIMAL(10,6) to DECIMAL(15,8).
 *
 * Run: node migrations/20260401_add_cost_breakdown_to_ai_token_usage.js
 */

import db from "../src/database/index.js";
import { QueryInterface, DataTypes } from "sequelize";

const TABLE = "ai_token_usage";

const up = async () => {
  const qi = db.sequelize.getQueryInterface();

  // Widen existing column first
  await qi.changeColumn(TABLE, "estimated_cost", {
    type: DataTypes.DECIMAL(15, 8),
    allowNull: false,
    defaultValue: 0,
  });

  const existingCols = await qi.describeTable(TABLE);

  const addIfMissing = async (colName, definition) => {
    if (!existingCols[colName]) {
      await qi.addColumn(TABLE, colName, definition);
      console.log(`  ✅ Added column: ${colName}`);
    } else {
      console.log(`  ⏭  Skipped (already exists): ${colName}`);
    }
  };

  await addIfMissing("input_rate", {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true,
    comment: "Input rate used at call time (USD per 1M tokens)",
    after: "estimated_cost",
  });

  await addIfMissing("output_rate", {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true,
    comment: "Output rate used at call time (USD per 1M tokens)",
    after: "input_rate",
  });

  await addIfMissing("markup_percent", {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: "Platform markup % applied at call time",
    after: "output_rate",
  });

  await addIfMissing("usd_to_inr_rate", {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true,
    comment: "USD to INR rate used at call time",
    after: "markup_percent",
  });

  await addIfMissing("base_cost_usd", {
    type: DataTypes.DECIMAL(15, 8),
    allowNull: true,
    comment: "Raw cost before markup (USD)",
    after: "usd_to_inr_rate",
  });

  await addIfMissing("final_cost_usd", {
    type: DataTypes.DECIMAL(15, 8),
    allowNull: true,
    comment: "Cost after markup (USD)",
    after: "base_cost_usd",
  });

  await addIfMissing("final_cost_inr", {
    type: DataTypes.DECIMAL(15, 6),
    allowNull: true,
    comment: "Final cost in INR — authoritative value for display",
    after: "final_cost_usd",
  });

  console.log("\n✅ Migration complete: ai_token_usage cost breakdown columns added.");
};

const run = async () => {
  console.log("🔌 Connecting to database...");
  await db.sequelize.authenticate();
  console.log("✅ Connected\n");
  console.log(`📦 Migrating table: ${TABLE}\n`);
  await up();
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
