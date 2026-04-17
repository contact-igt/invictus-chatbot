import { describe, expect, it, jest } from "@jest/globals";

const mockQuery = jest
  .fn()
  .mockResolvedValueOnce([[{ status: "active" }]])
  .mockResolvedValueOnce([[]]);

const mockUsageRecord = {
  id: 42,
  status: "sent",
  update: jest.fn(),
};

const mockDb = {
  sequelize: {
    query: mockQuery,
  },
  MessageUsage: {
    findOrCreate: jest.fn().mockResolvedValue([mockUsageRecord, false]),
  },
  BillingLedger: {
    findOne: jest.fn().mockResolvedValue({ id: 91 }),
    create: jest.fn(),
  },
};

const mockRecordBillingHealthEvent = jest.fn().mockResolvedValue();
const mockResolveMessageBillingReconciliation = jest
  .fn()
  .mockResolvedValue(true);

jest.unstable_mockModule("../src/database/index.js", () => ({
  default: mockDb,
}));

jest.unstable_mockModule("../src/middlewares/socket/socket.js", () => ({
  getIO: () => ({
    to: () => ({ emit: jest.fn() }),
  }),
}));

jest.unstable_mockModule("../src/utils/billing/costEstimator.js", () => ({
  estimateMetaCost: jest.fn(),
}));

jest.unstable_mockModule("../src/utils/billing/walletGuard.js", () => ({
  deductWallet: jest.fn(),
}));

jest.unstable_mockModule("../src/utils/billing/usageLimiter.js", () => ({
  checkUsageLimit: jest.fn(),
  invalidateUsageCache: jest.fn(),
}));

jest.unstable_mockModule(
  "../src/utils/billing/billingHealthMonitor.js",
  () => ({
    recordHealthEvent: jest.fn(),
  }),
);

jest.unstable_mockModule("../src/utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule("../src/utils/healthEventService.js", () => ({
  createCorrelationId: jest.fn().mockReturnValue("corr_1"),
  buildBillingContext: jest.fn().mockImplementation((context) => context),
  logBillingEvent: jest.fn(),
  recordBillingHealthEvent: mockRecordBillingHealthEvent,
}));

jest.unstable_mockModule("../src/services/reconciliationService.js", () => ({
  resolveMessageBillingReconciliation: mockResolveMessageBillingReconciliation,
}));

const { processBillingFromWebhook } =
  await import("../src/models/BillingModel/billing.service.js");

describe("processBillingFromWebhook", () => {
  it("records duplicate webhook events without creating a second ledger row", async () => {
    await processBillingFromWebhook("tenant-1", {
      id: "wamid-123",
      status: "delivered",
      pricing: {
        category: "MARKETING",
        billable: true,
      },
      conversation: {
        id: "conv-1",
      },
    });

    expect(mockDb.MessageUsage.findOrCreate).toHaveBeenCalled();
    expect(mockDb.BillingLedger.findOne).toHaveBeenCalledWith({
      where: { message_usage_id: 42 },
    });
    expect(mockDb.BillingLedger.create).not.toHaveBeenCalled();
    expect(mockRecordBillingHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "duplicate_webhook",
        tenant_id: "tenant-1",
      }),
    );
    expect(mockResolveMessageBillingReconciliation).toHaveBeenCalledWith(
      "tenant-1",
      "wamid-123",
    );
  });
});
