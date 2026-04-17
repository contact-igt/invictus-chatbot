import crypto from "crypto";
import { describe, expect, it, jest } from "@jest/globals";

process.env.RAZORPAY_KEY_ID = "rzp_test_12345678";
process.env.RAZORPAY_KEY_SECRET = "secret_123";

const mockRecordBillingHealthEvent = jest.fn().mockResolvedValue();
const mockWalletCreate = jest.fn();

const mockDb = {
  sequelize: {
    transaction: jest
      .fn()
      .mockImplementation(async (callback) =>
        callback({ LOCK: { UPDATE: "UPDATE" } }),
      ),
  },
  PaymentHistory: {
    findOne: jest
      .fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ status: "success" }),
  },
  WalletTransactions: {
    create: mockWalletCreate,
  },
};

jest.unstable_mockModule("razorpay", () => ({
  default: class Razorpay {
    constructor() {
      this.orders = {
        create: jest.fn(),
        fetch: jest.fn(),
      };
    }
  },
}));

jest.unstable_mockModule("../src/database/index.js", () => ({
  default: mockDb,
}));

jest.unstable_mockModule("../src/middlewares/socket/socket.js", () => ({
  getIO: () => ({
    to: () => ({ emit: jest.fn() }),
  }),
}));

jest.unstable_mockModule("../src/utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.unstable_mockModule("../src/utils/gstCalculator.js", () => ({
  calculateGST: jest.fn(),
}));

jest.unstable_mockModule("../src/services/taxSettings.service.js", () => ({
  getActiveGSTRate: jest.fn(),
}));

jest.unstable_mockModule("../src/utils/healthEventService.js", () => ({
  createCorrelationId: jest.fn().mockReturnValue("corr_pay_1"),
  buildBillingContext: jest.fn().mockImplementation((context) => context),
  logBillingEvent: jest.fn(),
  recordBillingHealthEvent: mockRecordBillingHealthEvent,
}));

const { verifyRazorpayPaymentService } =
  await import("../src/models/PaymentModel/payment.service.js");

describe("verifyRazorpayPaymentService", () => {
  it("treats duplicate payment verification as idempotent success", async () => {
    const body = "order_123|pay_123";
    const signature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    const result = await verifyRazorpayPaymentService("tenant-1", {
      razorpay_order_id: "order_123",
      razorpay_payment_id: "pay_123",
      razorpay_signature: signature,
    });

    expect(result).toEqual({
      success: true,
      message: "Payment already verified",
    });
    expect(mockRecordBillingHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "duplicate_payment",
        tenant_id: "tenant-1",
      }),
    );
    expect(mockWalletCreate).not.toHaveBeenCalled();
  });
});
