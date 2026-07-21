import { jest } from "@jest/globals";
import { readFileSync } from "node:fs";

const state = {
  mode: "prepaid",
  wallet: 0,
  creditLimit: 5000,
  usage: 0,
  overdue: false,
  holds: [],
};

const row = (value) => ({
  ...value,
  async update(changes) {
    Object.assign(this, changes);
    return this;
  },
});

let transactionTail = Promise.resolve();
const sequelize = {
  transaction: async (callback) => {
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback({ LOCK: { UPDATE: "UPDATE" } });
    } finally {
      release();
    }
  },
};

const db = {
  Sequelize: { Op: { or: Symbol("or"), lt: Symbol("lt") } },
  sequelize,
  Tenants: {
    findOne: jest.fn(async () => row({
      billing_mode: state.mode,
      postpaid_credit_limit: state.creditLimit,
    })),
  },
  Wallets: {
    findOne: jest.fn(async () => row({ balance: state.wallet })),
  },
  MonthlyInvoices: {
    findOne: jest.fn(async () => state.overdue ? { invoice_number: "INV-OVERDUE" } : null),
  },
  BillingCycles: {
    findOne: jest.fn(async () => ({ total_cost_inr: state.usage })),
  },
  BillingHolds: {
    sum: jest.fn(async (_field, options) => state.holds
      .filter((hold) => hold.status === "active"
        && hold.tenant_id === options.where.tenant_id
        && hold.billing_mode === options.where.billing_mode)
      .reduce((sum, hold) => sum + Number(hold.remaining_amount), 0)),
    create: jest.fn(async (value) => {
      const hold = row({ ...value });
      state.holds.push(hold);
      return hold;
    }),
    findOne: jest.fn(async ({ where }) => state.holds.find((hold) => hold.hold_id === where.hold_id) || null),
  },
};

jest.unstable_mockModule("../src/database/index.js", () => ({ default: db }));

const { checkBillingAccess } = await import("../src/services/billingAccess.service.js");
const { createBillingHold, releaseBillingHold } = await import("../src/services/billingHold.service.js");

beforeEach(() => {
  state.mode = "prepaid";
  state.wallet = 0;
  state.creditLimit = 5000;
  state.usage = 0;
  state.overdue = false;
  state.holds.length = 0;
});

test("prepaid wallet ₹0.21 blocks a ₹31 campaign", async () => {
  state.wallet = 0.21;
  const result = await checkBillingAccess("tenant-1", 31);
  expect(result).toMatchObject({ billing_mode: "prepaid", is_sufficient: false, wallet_balance: 0.21 });
  expect(result.shortfall).toBeCloseTo(30.79);
});

test("postpaid ignores a low wallet when available credit covers the campaign", async () => {
  state.mode = "postpaid";
  state.wallet = 0.21;
  state.creditLimit = 100;
  state.usage = 20;
  const result = await checkBillingAccess("tenant-1", 31);
  expect(result).toMatchObject({ billing_mode: "postpaid", is_sufficient: true, available_amount: 80 });
});

test("postpaid overdue invoice blocks access", async () => {
  state.mode = "postpaid";
  state.overdue = true;
  const result = await checkBillingAccess("tenant-1", 1);
  expect(result.is_sufficient).toBe(false);
  expect(result.blocked_reason).toContain("INV-OVERDUE");
});

test("postpaid remaining credit below estimate blocks access", async () => {
  state.mode = "postpaid";
  state.creditLimit = 50;
  state.usage = 25;
  const result = await checkBillingAccess("tenant-1", 31);
  expect(result).toMatchObject({ is_sufficient: false, available_amount: 25, shortfall: 6 });
});

test("zero-cost authorization creates no hold", async () => {
  state.wallet = 0;
  const result = await createBillingHold({ tenantId: "tenant-1", amount: 0 });
  expect(result.success).toBe(true);
  expect(result.hold).toBeNull();
  expect(state.holds).toHaveLength(0);
});

test("two concurrent prepaid campaigns cannot overspend", async () => {
  state.wallet = 100;
  const results = await Promise.all([
    createBillingHold({ tenantId: "tenant-1", amount: 60 }),
    createBillingHold({ tenantId: "tenant-1", amount: 60 }),
  ]);
  expect(results.filter((result) => result.success)).toHaveLength(1);
  expect(results.filter((result) => !result.success)).toHaveLength(1);
});

test("two concurrent postpaid campaigns cannot exceed credit", async () => {
  state.mode = "postpaid";
  state.creditLimit = 100;
  const results = await Promise.all([
    createBillingHold({ tenantId: "tenant-1", amount: 60 }),
    createBillingHold({ tenantId: "tenant-1", amount: 60 }),
  ]);
  expect(results.filter((result) => result.success)).toHaveLength(1);
});

test("releasing a hold atomically restores availability", async () => {
  state.wallet = 100;
  const held = await createBillingHold({ tenantId: "tenant-1", amount: 60 });
  expect((await checkBillingAccess("tenant-1", 50)).is_sufficient).toBe(false);
  await releaseBillingHold(held.hold.hold_id, "test_release");
  expect((await checkBillingAccess("tenant-1", 50)).is_sufficient).toBe(true);
});
const source = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("scheduled dispatch is revalidated and never uses the prepaid Redis reservation", () => {
  const worker = source("src/workers/campaignDispatchWorker.js");
  expect(worker).toContain('campaign.status === "scheduled"');
  expect(worker).toContain("createBillingHold({");
  expect(worker).not.toContain("createReservation(");
});

test("resume validates billing while execute preserves intentional pauses", () => {
  const service = source("src/models/WhatsappCampaignModel/whatsappcampaign.service.js");
  expect(service).toContain("const access = await checkBillingAccess(tenant_id, estimatedCost)");
  expect(service).toContain("Campaign is paused and must be resumed before execution");
});

test("in-flight messages persist and consume their authorized mode snapshot", () => {
  const worker = source("src/workers/campaignDispatchWorker.js");
  const billing = source("src/models/BillingModel/billing.service.js");
  expect(worker).toContain("authorized_billing_mode: authorizedBillingMode");
  expect(billing).toContain("usageRecord.billing_mode_snapshot || tenant?.billing_mode");
  expect(billing).toContain("consumeBillingHoldAllocation(");
});

test("duplicate priced webhooks return when a ledger already exists", () => {
  const billing = source("src/models/BillingModel/billing.service.js");
  expect(billing).toMatch(/if \(existingLedger\) \{[\s\S]*duplicate_webhook[\s\S]*return;/);
});

test("manual message and AI wrappers use canonical billing access", () => {
  const walletGuard = source("src/utils/billing/walletGuard.js");
  expect(walletGuard).toContain('from "../../services/billingAccess.service.js"');
  expect(walletGuard).toMatch(/canSendMessage[\s\S]*checkBillingAccess/);
  expect(walletGuard).toMatch(/canUseAI[\s\S]*canSendMessage/);
});

test("force unlock moves the due date so access is actually restored", () => {
  const adminBilling = source("src/models/BillingModel/adminBilling.service.js");
  expect(adminBilling).toContain("graceDueDate");
  expect(adminBilling).toContain('{ status: "unpaid", due_date: graceDueDate }');
});