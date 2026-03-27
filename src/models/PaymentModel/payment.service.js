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
    // 1. Transaction to credit wallet and log record
    const amountInPaise = paymentData.amount || 0;
    const amountInRupees = amountInPaise / 100;

    await db.sequelize.transaction(async (t) => {
      let [wallet] = await db.Wallets.findOrCreate({
        where: { tenant_id },
        defaults: { tenant_id, balance: 0, currency: "INR" },
        transaction: t,
      });

      const newBalance = parseFloat(wallet.balance) + amountInRupees;
      await wallet.update({ balance: newBalance }, { transaction: t });

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
    });

    // 2. Check if wallet was restored from suspension and emit socket update
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
