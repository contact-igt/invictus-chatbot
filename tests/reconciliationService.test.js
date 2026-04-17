import { describe, expect, it, jest } from "@jest/globals";

const mockRecordBillingHealthEvent = jest.fn().mockResolvedValue();
const mockLogBillingEvent = jest.fn();

const mockDb = {
  sequelize: {
    query: jest
      .fn()
      .mockResolvedValueOnce([
        [
          {
            id: 11,
            wamid: "wamid-1",
            tenant_id: "tenant-1",
            created_at: new Date("2024-01-01T00:00:00.000Z"),
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: 22,
            message_id: "wamid-2",
            tenant_id: "tenant-2",
            created_at: new Date("2024-01-01T00:00:00.000Z"),
          },
        ],
      ]),
  },
  Messages: {
    update: jest.fn().mockResolvedValueOnce([1]).mockResolvedValueOnce([1]),
  },
  Sequelize: {
    Op: {
      or: Symbol("or"),
      ne: Symbol("ne"),
    },
  },
};

jest.unstable_mockModule("../src/database/index.js", () => ({
  default: mockDb,
}));

jest.unstable_mockModule("../src/utils/healthEventService.js", () => ({
  createCorrelationId: jest.fn().mockReturnValue("recon_1"),
  buildBillingContext: jest.fn().mockImplementation((context) => context),
  logBillingEvent: mockLogBillingEvent,
  recordBillingHealthEvent: mockRecordBillingHealthEvent,
}));

const { reconcileMissingMessageBilling } =
  await import("../src/services/reconciliationService.js");

describe("reconcileMissingMessageBilling", () => {
  it("marks unresolved messages and missing ledgers separately", async () => {
    const result = await reconcileMissingMessageBilling({
      delayMinutes: 5,
      limit: 10,
    });

    expect(result.unresolvedMessages).toBe(1);
    expect(result.missingLedgerCount).toBe(1);
    expect(mockRecordBillingHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "missing_message_billing",
        tenant_id: "tenant-1",
      }),
    );
    expect(mockRecordBillingHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "missing_ledger_detected",
        tenant_id: "tenant-2",
      }),
    );
    expect(mockDb.Messages.update).toHaveBeenCalledTimes(2);
  });
});
