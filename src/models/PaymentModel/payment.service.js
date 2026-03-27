import Razorpay from "razorpay";
import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";
import crypto from "crypto";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_placeholder",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "placeholder_secret",
});

console.log(
  "[PAYMENT] Razorpay initialized with Key ID:",
  process.env.RAZORPAY_KEY_ID
    ? `${process.env.RAZORPAY_KEY_ID.slice(0, 8)}...`
    : "MISSING",
);

/**
 * Creates a Razorpay order for wallet recharge.
 */
export const createRazorpayOrderService = async (tenant_id, amount) => {
  try {
    console.log(
      `[PAYMENT] Creating order for Tenant: ${tenant_id}, Amount: ${amount}`,
    );

    if (
      !process.env.RAZORPAY_KEY_ID ||
      process.env.RAZORPAY_KEY_ID === "rzp_test_placeholder"
    ) {
      throw new Error(
        "Razorpay Key ID is missing or invalid in environment variables",
      );
    }

    const options = {
      amount: Math.round(amount * 100), // convert to paise
      currency: "INR",
      receipt: `recharge_${Date.now()}_${tenant_id}`,
    };

    console.log("[PAYMENT] Razorpay Options:", options);
    const order = await razorpay.orders.create(options);
    console.log("[PAYMENT] Order created successfully:", order.id);
    return order;
  } catch (error) {
    console.error("[PAYMENT SERVICE] Error creating order:", error);
    // Log more specific Razorpay errors if they exist
    if (error.error)
      console.error(
        "[PAYMENT SERVICE] Razorpay API Error Details:",
        error.error,
      );
    throw error;
  }
};

/**
 * Verifies Razorpay payment signature and credits the wallet.
 */
export const verifyRazorpayPaymentService = async (tenant_id, paymentData) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    paymentData;

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac(
      "sha256",
      process.env.RAZORPAY_KEY_SECRET || "placeholder_secret",
    )
    .update(body.toString())
    .digest("hex");

  if (expectedSignature === razorpay_signature) {
    // 1. Check for duplicate payment verification (idempotency)
    const existingPayment = await db.PaymentHistory.findOne({
      where: { razorpay_payment_id },
    });
    if (existingPayment) {
      console.log(
        `[PAYMENT] Payment ${razorpay_payment_id} already verified, skipping duplicate`,
      );
      return { success: true, message: "Payment already verified" };
    }

    // 2. Transaction to credit wallet and log record
    const amountInPaise = paymentData.amount || 0;
    const amountInRupees = amountInPaise / 100;

    // Generate invoice number: INV-YYYYMMDD-XXXXX
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomSuffix = Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase();
    const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;

    await db.sequelize.transaction(async (t) => {
      let [wallet] = await db.Wallets.findOrCreate({
        where: { tenant_id },
        defaults: { tenant_id, balance: 0, currency: "INR" },
        transaction: t,
      });

      // NaN protection: ensure balance is a valid number
      const currentBalance = parseFloat(wallet.balance) || 0;
      const newBalance = currentBalance + amountInRupees;
      await wallet.update({ balance: newBalance }, { transaction: t });

      // Save to WalletTransactions (for legacy compatibility)
      await db.WalletTransactions.create(
        {
          tenant_id,
          type: "credit",
          amount: amountInRupees,
          reference_id: razorpay_payment_id,
          description: "Wallet Recharge (Online)",
          balance_after: newBalance,
        },
        { transaction: t },
      );

      // Save to PaymentHistory (dedicated payment tracking)
      await db.PaymentHistory.create(
        {
          tenant_id,
          razorpay_order_id,
          razorpay_payment_id,
          amount: amountInRupees,
          currency: "INR",
          status: "success",
          payment_method: "Online",
          description: "Wallet Recharge",
          balance_before: currentBalance,
          balance_after: newBalance,
          invoice_number: invoiceNumber,
          metadata: {
            order_id: razorpay_order_id,
            verified_at: new Date().toISOString(),
          },
        },
        { transaction: t },
      );
    });

    // 3. Check if wallet was restored from suspension and emit socket update
    try {
      const wallet = await db.Wallets.findOne({ where: { tenant_id } });
      const newBalance = parseFloat(wallet.balance);

      const io = getIO();

      // Emit payment success
      io.to(`tenant-${tenant_id}`).emit("payment-update", {
        type: "PAYMENT_SUCCESS",
        amount: amountInRupees,
        balance: newBalance,
      });

      // If balance was restored from negative/suspended state, emit restoration event
      if (newBalance > 0) {
        const { checkAndRestoreWallet } =
          await import("../../utils/billing/walletGuard.js");
        await checkAndRestoreWallet(tenant_id, newBalance);
        console.log(
          `[PAYMENT] Wallet restored for tenant ${tenant_id}. New balance: ₹${newBalance.toFixed(2)}`,
        );
      }
    } catch (err) {
      console.error("[PAYMENT] Socket emit error:", err.message);
    }

    return { success: true, message: "Payment verified and wallet credited" };
  } else {
    throw new Error("Invalid payment signature");
  }
};

/**
 * Fetch payment history for a tenant from the dedicated PaymentHistory table.
 * Only shows successful recharge payments.
 */
export const getPaymentHistoryService = async (
  tenant_id,
  page = 1,
  limit = 50,
) => {
  try {
    const offset = (page - 1) * limit;
    const { count, rows } = await db.PaymentHistory.findAndCountAll({
      where: { tenant_id, status: "success" },
      order: [["created_at", "DESC"]],
      limit: parseInt(limit),
      offset,
    });

    return {
      payments: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit),
      },
    };
  } catch (error) {
    console.error("[PAYMENT] Error fetching payment history:", error);
    throw error;
  }
};
