import { describe, expect, it, jest } from "@jest/globals";

const mockDb = {
  sequelize: {
    query: jest
      .fn()
      .mockResolvedValueOnce([
        [
          {
            charged_total: "125.50",
            unpaid_total: "20.00",
            free_total: "0.00",
            attempted_total: "145.50",
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            category: "marketing",
            totalSpentInr: "100.50",
            totalSpentUsd: "1.20",
          },
          {
            category: "service",
            totalSpentInr: "25.00",
            totalSpentUsd: "0.30",
          },
        ],
      ]),
  },
  MessageUsage: {
    count: jest
      .fn()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3),
  },
  Wallets: {
    findOrCreate: jest.fn().mockResolvedValue([
      {
        balance: "55.25",
        currency: "INR",
      },
    ]),
  },
  AiTokenUsage: {
    count: jest.fn().mockResolvedValueOnce(9).mockResolvedValueOnce(4),
  },
};

jest.unstable_mockModule("../src/database/index.js", () => ({
  default: mockDb,
}));

jest.unstable_mockModule("../src/middlewares/socket/socket.js", () => ({
  getIO: jest.fn(),
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
  createCorrelationId: jest.fn(),
  buildBillingContext: jest.fn(),
  logBillingEvent: jest.fn(),
  recordBillingHealthEvent: jest.fn(),
}));

jest.unstable_mockModule("../src/services/reconciliationService.js", () => ({
  resolveMessageBillingReconciliation: jest.fn(),
}));

const { getBillingKpiService } =
  await import("../src/models/BillingModel/billing.service.js");

describe("getBillingKpiService", () => {
  it("separates charged, unpaid, free, and attempted totals", async () => {
    const result = await getBillingKpiService("tenant-1");

    expect(result).toEqual(
      expect.objectContaining({
        totalSpentEstimated: 125.5,
        charged_total: 125.5,
        unpaid_total: 20,
        free_total: 0,
        attempted_total: 145.5,
        chargedTotal: 125.5,
        unpaidTotal: 20,
        freeTotal: 0,
        attemptedTotal: 145.5,
        totalMessagesSent: 7,
        billableConversations: 5,
        freeConversations: 2,
        todayMessagesSent: 3,
        totalAiCalls: 9,
        todayAiCalls: 4,
        walletBalance: 55.25,
        marketingSpent: 100.5,
        serviceSpent: 25,
      }),
    );
  });
});
