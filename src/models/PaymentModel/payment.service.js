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

    // 3. Emit socket update for payment success
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

      // Emit restoration event if balance is positive
      if (newBalance > 0) {
        io.to(`tenant-${tenant_id}`).emit("wallet-restored", {
          tenant_id,
          balance: newBalance,
          status: newBalance > 100 ? "healthy" : "low",
          message: "Services restored! Your account is now active.",
        });
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

/**
 * Pay a specific monthly invoice via Razorpay.
 * Matches by invoice_id + tenant_id (NEVER by amount alone).
 */
export const payInvoiceService = async (tenant_id, invoice_id, paymentData) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    paymentData;

  // 1. Verify Razorpay signature
  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac(
      "sha256",
      process.env.RAZORPAY_KEY_SECRET || "placeholder_secret",
    )
    .update(body.toString())
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    throw new Error("Invalid payment signature");
  }

  // 2. Look up invoice by id AND tenant_id (tenant scoping for security)
  const invoice = await db.MonthlyInvoices.findOne({
    where: { id: invoice_id, tenant_id },
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  if (invoice.status === "paid") {
    return { success: true, message: "Invoice already paid" };
  }

  if (invoice.status === "cancelled") {
    throw new Error("Invoice has been cancelled");
  }

  if (invoice.status !== "unpaid" && invoice.status !== "overdue") {
    throw new Error(`Invoice cannot be paid in status: ${invoice.status}`);
  }

  // 3. Check for duplicate payment
  const existingPayment = await db.PaymentHistory.findOne({
    where: { razorpay_payment_id },
  });
  if (existingPayment) {
    return { success: true, message: "Payment already verified" };
  }

  // 4. Mark invoice as paid (atomic)
  await db.sequelize.transaction(async (t) => {
    await invoice.update(
      {
        status: "paid",
        paid_at: new Date(),
        payment_reference: razorpay_payment_id,
      },
      { transaction: t },
    );

    // Record in payment history
    await db.PaymentHistory.create(
      {
        tenant_id,
        razorpay_order_id,
        razorpay_payment_id,
        amount: parseFloat(invoice.amount),
        currency: "INR",
        status: "success",
        payment_method: "Online",
        description: `Invoice Payment: ${invoice.invoice_number}`,
        balance_before: 0,
        balance_after: 0,
        invoice_number: invoice.invoice_number,
        metadata: {
          invoice_id: invoice.id,
          billing_cycle_id: invoice.billing_cycle_id,
          verified_at: new Date().toISOString(),
        },
      },
      { transaction: t },
    );
  });

  // 5. Emit socket event
  try {
    const { getIO } = await import("../../middlewares/socket/socket.js");
    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("invoice-paid", {
      invoice_number: invoice.invoice_number,
      amount: parseFloat(invoice.amount),
    });
  } catch (_) {}

  console.log(
    `[PAYMENT] Invoice ${invoice.invoice_number} paid for tenant ${tenant_id}. Payment: ${razorpay_payment_id}`,
  );

  return {
    success: true,
    message: "Invoice paid successfully",
    invoice_number: invoice.invoice_number,
  };
};

/**
 * Record a failed invoice payment attempt.
 */
export const recordInvoicePaymentFailure = async (tenant_id, invoice_id) => {
  const MAX_RETRIES = 3;

  const invoice = await db.MonthlyInvoices.findOne({
    where: { id: invoice_id, tenant_id },
  });

  if (!invoice) return;

  await invoice.increment("retry_count");
  await invoice.update({ last_retry_at: new Date() });

  if (invoice.retry_count + 1 >= MAX_RETRIES) {
    try {
      const { getIO } = await import("../../middlewares/socket/socket.js");
      const io = getIO();
      io.emit("payment-failure-alert", {
        tenant_id,
        invoice_number: invoice.invoice_number,
        retry_count: invoice.retry_count + 1,
      });
    } catch (_) {}

    console.warn(
      `[PAYMENT] Max retries reached for ${invoice.invoice_number}, tenant ${tenant_id}`,
    );
  }
};
