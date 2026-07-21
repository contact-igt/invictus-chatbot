/**
 * Atomic campaign billing holds and in-flight billing-mode snapshots.
 * Run before deploying application/worker code:
 *   node migrations/20260721_add_atomic_billing_holds.js
 * Roll back only after rolling application code back:
 *   node migrations/20260721_add_atomic_billing_holds.js down
 */
import db from "../src/database/index.js";

const qi = db.sequelize.getQueryInterface();
const S = db.Sequelize;

const describe = async (table) => {
  try {
    return await qi.describeTable(table);
  } catch (error) {
    if (/doesn.t exist|unknown table|no description found/i.test(error.message)) return null;
    throw error;
  }
};

const addColumnIfMissing = async (table, column, definition) => {
  const columns = await describe(table);
  if (!columns) throw new Error(`Required table is missing: ${table}`);
  if (!columns[column]) await qi.addColumn(table, column, definition);
};

const removeColumnIfPresent = async (table, column) => {
  const columns = await describe(table);
  if (columns?.[column]) await qi.removeColumn(table, column);
};

const ensureHoldTable = async () => {
  if (await describe("billing_holds")) return;
  await qi.createTable("billing_holds", {
    id: { type: S.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
    hold_id: { type: S.STRING(96), allowNull: false, unique: true },
    tenant_id: { type: S.STRING, allowNull: false },
    campaign_id: { type: S.STRING, allowNull: true },
    billing_mode: { type: S.ENUM("prepaid", "postpaid"), allowNull: false },
    amount: { type: S.DECIMAL(15, 6), allowNull: false },
    remaining_amount: { type: S.DECIMAL(15, 6), allowNull: false },
    status: {
      type: S.ENUM("active", "consumed", "released"),
      allowNull: false,
      defaultValue: "active",
    },
    expires_at: { type: S.DATE, allowNull: false },
    released_at: { type: S.DATE, allowNull: true },
    release_reason: { type: S.STRING(255), allowNull: true },
    metadata: { type: S.JSON, allowNull: true },
    created_at: { type: S.DATE, allowNull: false, defaultValue: S.literal("CURRENT_TIMESTAMP") },
    updated_at: { type: S.DATE, allowNull: false, defaultValue: S.literal("CURRENT_TIMESTAMP") },
  }, { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" });
  await qi.addIndex("billing_holds", ["tenant_id", "status"], { name: "idx_billing_holds_tenant_status" });
  await qi.addIndex("billing_holds", ["campaign_id"], { name: "idx_billing_holds_campaign" });
  await qi.addIndex("billing_holds", ["status", "expires_at"], { name: "idx_billing_holds_expiry" });
};

const up = async () => {
  await ensureHoldTable();
  await addColumnIfMissing("whatsapp_campaign_recipients", "billing_hold_id", { type: S.STRING(96), allowNull: true });
  await addColumnIfMissing("whatsapp_campaign_recipients", "authorized_billing_mode", { type: S.ENUM("prepaid", "postpaid"), allowNull: true });
  await addColumnIfMissing("whatsapp_campaign_recipients", "authorized_cost_inr", { type: S.DECIMAL(15, 6), allowNull: true });

  const recipientIndexes = await qi.showIndex("whatsapp_campaign_recipients");
  if (!recipientIndexes.some((index) => index.name === "idx_recipient_billing_hold")) {
    await qi.addIndex("whatsapp_campaign_recipients", ["billing_hold_id"], { name: "idx_recipient_billing_hold" });
  }

  await addColumnIfMissing("messages", "billing_mode_snapshot", { type: S.ENUM("prepaid", "postpaid"), allowNull: true });
  await addColumnIfMissing("message_usage", "billing_mode_snapshot", { type: S.ENUM("prepaid", "postpaid"), allowNull: true });
  await addColumnIfMissing("billing_ledger", "billing_mode_snapshot", { type: S.ENUM("prepaid", "postpaid"), allowNull: true });
};

const down = async () => {
  await removeColumnIfPresent("billing_ledger", "billing_mode_snapshot");
  await removeColumnIfPresent("message_usage", "billing_mode_snapshot");
  await removeColumnIfPresent("messages", "billing_mode_snapshot");
  await removeColumnIfPresent("whatsapp_campaign_recipients", "authorized_cost_inr");
  await removeColumnIfPresent("whatsapp_campaign_recipients", "authorized_billing_mode");
  await removeColumnIfPresent("whatsapp_campaign_recipients", "billing_hold_id");
  if (await describe("billing_holds")) await qi.dropTable("billing_holds");
};

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  try {
    await (direction === "down" ? down() : up());
    console.log(`[MIGRATION] ${direction.toUpperCase()} atomic billing holds completed`);
    process.exit(0);
  } catch (error) {
    console.error(`[MIGRATION] ${direction.toUpperCase()} failed:`, error.message);
    process.exit(1);
  }
};

run();