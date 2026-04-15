import Razorpay from "razorpay";
import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";
import crypto from "crypto";
import { logger } from "../../utils/logger.js";
import {
  calculateGST,
  getWalletCreditAmount,
} from "../../utils/gstCalculator.js";
import { getActiveGSTRate } from "../../services/taxSettings.service.js";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

logger.info(
  "[PAYMENT] Razorpay initialized with Key ID:",
  process.env.RAZORPAY_KEY_ID
    ? `${process.env.RAZORPAY_KEY_ID.slice(0, 8)}...`
    : "MISSING",
);

/**
 * Validate Razorpay configuration at startup.
 * Throws if key is missing or is the placeholder value.
 */
export const validateRazorpayConfig = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || keyId === "rzp_test_placeholder") {
    throw new Error(
      "[PAYMENT] RAZORPAY_KEY_ID is missing or is a placeholder. Set a real key in .env before starting.",
    );
  }
  if (!keySecret) {
    throw new Error(
      "[PAYMENT] RAZORPAY_KEY_SECRET is missing. Set it in .env before starting.",
    );
  }
};

/**
 * Creates a Razorpay order for wallet recharge.
 * Also records a 'pending' PaymentHistory row so the verify step can
 * validate the authoritative amount instead of trusting the client payload.
 */
export const createRazorpayOrderService = async (tenant_id, amount) => {
  try {
    logger.debug(
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

    const order = await razorpay.orders.create(options);
    logger.debug(`[PAYMENT] Order created successfully: ${order.id}`);

    // Persist a pending record so verify can cross-check the authoritative amount
    await db.PaymentHistory.create({
      tenant_id,
      razorpay_order_id: order.id,
      razorpay_payment_id: null,
      amount: amount, // INR — from validated server input, not client
      currency: "INR",
      status: "pending",
      payment_method: "Online",
      description: "Wallet Recharge (Pending)",
      balance_before: null,
      balance_after: null,
      invoice_number: null,
      metadata: { created_at: new Date().toISOString() },
    });

    return order;
  } catch (error) {
    logger.error("[PAYMENT SERVICE] Error creating order:", error);
    if (error.error)
      logger.error(
        "[PAYMENT SERVICE] Razorpay API Error Details:",
        error.error,
      );
    throw error;
  }
};

/**
 * Verifies Razorpay payment signature and credits the wallet.
 * Amount is taken from the server-side pending PaymentHistory record
 * (created during order creation) — NEVER from the client payload.
 */
export const verifyRazorpayPaymentService = async (tenant_id, paymentData) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    paymentData;

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!razorpaySecret) {
    throw new Error(
      "Payment system configuration error. Please contact support.",
    );
  }
  const expectedSignature = crypto
    .createHmac("sha256", razorpaySecret)
    .update(body.toString())
    .digest("hex");

  // 1. Verify signature first — throws immediately if invalid
  if (expectedSignature !== razorpay_signature) {
    throw new Error("Invalid payment signature");
  }

  // 2. Resolve authoritative amount from server-side pending record.
  //    This prevents clients from passing a manipulated amount in the payload.
  const pendingRecord = await db.PaymentHistory.findOne({
    where: { razorpay_order_id, tenant_id, status: "pending" },
  });

  let amountInRupees;
  if (pendingRecord) {
    amountInRupees = parseFloat(pendingRecord.amount);
  } else {
    // Fallback: fetch directly from Razorpay API (pending record may have been
    // lost due to a crash between order creation and payment completion)
    try {
      const order = await razorpay.orders.fetch(razorpay_order_id);
      amountInRupees = order.amount / 100;
      logger.warn(
        `[PAYMENT] No pending record for order ${razorpay_order_id} — used Razorpay API amount: ₹${amountInRupees}`,
      );
    } catch (fetchErr) {
      logger.error(
        "[PAYMENT] Could not fetch order from Razorpay:",
        fetchErr.message,
      );
      throw new Error("Payment order not found. Please contact support.");
    }
  }

  // Generate invoice number: INV-YYYYMMDD-XXXXX
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;

  // Calculate GST: tenant pays gross amount, wallet gets base amount only
  const tenant = await db.Tenants.findOne({
    where: { tenant_id },
    attributes: ["state"],
    raw: true,
  });
  const tenantState = tenant?.state?.trim()?.toUpperCase?.() || "";
  const companyState =
    process.env.COMPANY_STATE?.trim()?.toUpperCase?.() || "TN";

  const activeGstRate = await getActiveGSTRate();
  const gstResult = calculateGST(amountInRupees, tenantState, companyState, activeGstRate);
  const walletCreditAmount = parseFloat(gstResult.base_amount); // Only base amount credited to wallet
  const grossAmount = parseFloat(gstResult.gross_amount);
  const gstAmount = parseFloat(gstResult.gst_amount);

  await db.sequelize.transaction(async (t) => {
    // Check for duplicate payment INSIDE transaction (race-safe)
    const existingPayment = await db.PaymentHistory.findOne({
      where: { razorpay_payment_id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (existingPayment && existingPayment.status === "success") {
      logger.debug(
        `[PAYMENT] Payment ${razorpay_payment_id} already verified, skipping duplicate`,
      );
      return;
    }

    // Credit wallet with row-level lock — ONLY base_amount (after GST)
    let [wallet] = await db.Wallets.findOrCreate({
      where: { tenant_id },
      defaults: { tenant_id, balance: 0, currency: "INR" },
      transaction: t,
    });

    // NaN protection: ensure balance is a valid number
    const currentBalance = parseFloat(wallet.balance) || 0;
    const newBalance = currentBalance + walletCreditAmount; // Credit base_amount only
    await wallet.update({ balance: newBalance }, { transaction: t });

    // Save to WalletTransactions (audit trail) with GST breakdown
    await db.WalletTransactions.create(
      {
        tenant_id,
        type: "credit",
        amount: walletCreditAmount, // base_amount credited
        gross_amount: grossAmount,
        base_amount: walletCreditAmount,
        gst_amount: gstAmount,
        gst_rate: activeGstRate,
        reference_id: razorpay_payment_id,
        description: `Wallet Recharge (Online) - ₹${grossAmount} paid, ₹${walletCreditAmount} credited after ${activeGstRate}% GST`,
        balance_after: newBalance,
      },
      { transaction: t },
    );

    // Update or create PaymentHistory record (pending → success) with GST breakdown
    const paymentUpdateData = {
      razorpay_payment_id,
      status: "success",
      description: "Wallet Recharge",
      balance_before: currentBalance,
      balance_after: newBalance,
      invoice_number: invoiceNumber,
      gross_amount: grossAmount,
      base_amount: walletCreditAmount,
      gst_amount: gstAmount,
      is_intra_state: gstResult.is_intra_state,
      metadata: {
        order_id: razorpay_order_id,
        verified_at: new Date().toISOString(),
        gst_breakdown: gstResult,
      },
    };

    if (pendingRecord) {
      await pendingRecord.update(paymentUpdateData, { transaction: t });
    } else {
      await db.PaymentHistory.create(
        {
          tenant_id,
          razorpay_order_id,
          amount: walletCreditAmount, // actual wallet credit
          currency: "INR",
          payment_method: "Online",
          ...paymentUpdateData,
        },
        { transaction: t },
      );
    }
  });

  logger.info(
    `[PAYMENT] GST applied: ₹${grossAmount} paid → ₹${walletCreditAmount} credited + ₹${gstAmount} GST (${activeGstRate}%) for tenant ${tenant_id}`,
  );

  // Emit socket update for payment success
  try {
    const wallet = await db.Wallets.findOne({ where: { tenant_id } });
    const newBalance = parseFloat(wallet.balance);
    const io = getIO();

    io.to(`tenant-${tenant_id}`).emit("payment-update", {
      type: "PAYMENT_SUCCESS",
      grossAmount: grossAmount,
      walletCredit: walletCreditAmount,
      gstAmount: gstAmount,
      balance: newBalance,
      gstBreakdown: gstResult,
    });

    if (newBalance > 0) {
      io.to(`tenant-${tenant_id}`).emit("wallet-restored", {
        tenant_id,
        balance: newBalance,
        status: newBalance > 100 ? "healthy" : "low",
        message: "Services restored! Your account is now active.",
      });
      logger.info(
        `[PAYMENT] Wallet restored for tenant ${tenant_id}. New balance: ₹${newBalance.toFixed(2)}`,
      );
    }
  } catch (err) {
    logger.error("[PAYMENT] Socket emit error:", err.message);
  }

  return { success: true, message: "Payment verified and wallet credited" };
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
    logger.error("[PAYMENT] Error fetching payment history:", error);
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
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!razorpaySecret) {
    throw new Error(
      "Payment system configuration error. Please contact support.",
    );
  }
  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", razorpaySecret)
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

  // 3. Verify Razorpay order amount matches invoice amount (before transaction)
  try {
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const invoiceAmountPaise = Math.round(parseFloat(invoice.amount) * 100);
    if (order.amount !== invoiceAmountPaise) {
      throw new Error(
        `Payment amount mismatch: order ₹${(order.amount / 100).toFixed(2)} vs invoice ₹${parseFloat(invoice.amount).toFixed(2)}`,
      );
    }
  } catch (fetchErr) {
    if (fetchErr.message.includes("Payment amount mismatch")) throw fetchErr;
    logger.error("[PAYMENT] Razorpay order fetch failed:", fetchErr.message);
    // If Razorpay API is unreachable, proceed with signature verification only
  }

  // 4. Mark invoice as paid (atomic with duplicate check)
  await db.sequelize.transaction(async (t) => {
    // Check for duplicate payment INSIDE transaction (race-safe)
    const existingPayment = await db.PaymentHistory.findOne({
      where: { razorpay_payment_id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (existingPayment) {
      logger.debug(
        `[PAYMENT] Invoice payment ${razorpay_payment_id} already verified, skipping duplicate`,
      );
      return;
    }

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
        balance_before: null,
        balance_after: null,
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

  // 6. Emit socket events
  try {
    const { getIO } = await import("../../middlewares/socket/socket.js");
    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("invoice-paid", {
      invoice_number: invoice.invoice_number,
      amount: parseFloat(invoice.amount),
    });

    // Check if tenant is now unblocked (always check — invoice may have been overdue or freshly paid)
    const remainingOverdue = await db.MonthlyInvoices.count({
      where: { tenant_id, status: "overdue" },
    });
    if (remainingOverdue === 0) {
      io.to(`tenant-${tenant_id}`).emit("access-restored", { tenant_id });
    }
  } catch (_) {}

  logger.info(
    `[PAYMENT] Invoice ${invoice.invoice_number} paid for tenant ${tenant_id}. Payment: ${razorpay_payment_id}`,
  );

  return {
    success: true,
    message: "Invoice paid successfully",
    invoice_number: invoice.invoice_number,
  };
};

/**
 * Handle an incoming Razorpay webhook event.
 * Verified via the X-Razorpay-Signature header (HMAC-SHA256 of raw body).
 *
 * Supported events:
 *   payment.authorized  — payment captured; credit wallet / mark invoice paid
 *   payment.failed      — payment failed; record failure for retry
 */
export const handleRazorpayWebhookService = async (rawBody, signature) => {
  const razorpaySecret =
    process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
  if (!razorpaySecret) {
    throw new Error("Razorpay webhook secret not configured");
  }

  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac("sha256", razorpaySecret)
    .update(rawBody)
    .digest("hex");

  if (expectedSignature !== signature) {
    throw new Error("Invalid webhook signature");
  }

  const event = JSON.parse(rawBody);
  const eventType = event.event;
  const paymentEntity = event.payload?.payment?.entity;

  if (!paymentEntity) {
    logger.warn(`[PAYMENT-WEBHOOK] No payment entity in event: ${eventType}`);
    return { processed: false, reason: "no_payment_entity" };
  }

  const {
    id: razorpay_payment_id,
    order_id: razorpay_order_id,
    amount: amountPaise,
  } = paymentEntity;

  if (eventType === "payment.authorized" || eventType === "payment.captured") {
    // Look up pending PaymentHistory row to identify tenant + amount
    const pendingRecord = await db.PaymentHistory.findOne({
      where: { razorpay_order_id, status: "pending" },
    });

    if (!pendingRecord) {
      logger.warn(
        `[PAYMENT-WEBHOOK] No pending record for order ${razorpay_order_id} — event ${eventType}`,
      );
      return { processed: false, reason: "pending_record_not_found" };
    }

    const tenant_id = pendingRecord.tenant_id;
    // pendingRecord.amount is the GROSS amount the tenant paid (set at order creation)
    const amountInRupees = parseFloat(pendingRecord.amount);

    // Resolve GST — same logic as the /verify endpoint
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["state"],
      raw: true,
    });
    const tenantState = tenant?.state?.trim()?.toUpperCase?.() || "";
    const companyState =
      process.env.COMPANY_STATE?.trim()?.toUpperCase?.() || "TN";
    const webhookGstRate = await getActiveGSTRate();
    const gstResult = calculateGST(amountInRupees, tenantState, companyState, webhookGstRate);
    const walletCreditAmount = parseFloat(gstResult.base_amount);
    const grossAmount = parseFloat(gstResult.gross_amount);
    const gstAmount = parseFloat(gstResult.gst_amount);

    // Credit wallet atomically — idempotency guard is INSIDE the transaction with a row lock
    // to prevent double-credit when Razorpay delivers the webhook concurrently with /verify.
    await db.sequelize.transaction(async (t) => {
      // ── Idempotency check (inside transaction with lock) ──────────────────
      const alreadyProcessed = await db.PaymentHistory.findOne({
        where: { razorpay_payment_id, status: "success" },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (alreadyProcessed) {
        logger.debug(
          `[PAYMENT-WEBHOOK] Payment ${razorpay_payment_id} already processed, skipping`,
        );
        return; // transaction will commit a no-op
      }
      // ──────────────────────────────────────────────────────────────────────

      const [wallet] = await db.Wallets.findOrCreate({
        where: { tenant_id },
        defaults: { tenant_id, balance: 0, currency: "INR" },
        transaction: t,
      });

      const currentBalance = parseFloat(wallet.balance) || 0;
      // Credit only base_amount (after GST), matching the /verify endpoint
      const newBalance = currentBalance + walletCreditAmount;
      await wallet.update({ balance: newBalance }, { transaction: t });

      await db.WalletTransactions.create(
        {
          tenant_id,
          type: "credit",
          amount: walletCreditAmount,       // base_amount credited
          gross_amount: grossAmount,        // what tenant paid
          base_amount: walletCreditAmount,  // wallet credit (gross / 1.18)
          gst_amount: gstAmount,            // GST component
          gst_rate: webhookGstRate,
          reference_id: razorpay_payment_id,
          description: `Wallet Recharge (Webhook) — ₹${grossAmount} paid, ₹${walletCreditAmount} credited after ${webhookGstRate}% GST`,
          balance_after: newBalance,
        },
        { transaction: t },
      );

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const suffix = Math.random().toString(36).substring(2, 7).toUpperCase();
      await pendingRecord.update(
        {
          razorpay_payment_id,
          status: "success",
          description: "Wallet Recharge (Webhook)",
          balance_before: currentBalance,
          balance_after: newBalance,
          invoice_number: `INV-${dateStr}-${suffix}`,
          gross_amount: grossAmount,
          base_amount: walletCreditAmount,
          gst_amount: gstAmount,
          is_intra_state: gstResult.is_intra_state,
          metadata: {
            ...pendingRecord.metadata,
            razorpay_payment_id,
            webhook_event: eventType,
            captured_at: new Date().toISOString(),
            gst_breakdown: gstResult,
          },
        },
        { transaction: t },
      );
    });

    // Notify tenant via socket
    try {
      const io = getIO();
      const updatedWallet = await db.Wallets.findOne({ where: { tenant_id } });
      const newBalance = parseFloat(updatedWallet.balance);
      io.to(`tenant-${tenant_id}`).emit("payment-update", {
        type: "PAYMENT_SUCCESS",
        grossAmount: grossAmount,
        walletCredit: walletCreditAmount,
        gstAmount: gstAmount,
        balance: newBalance,
        source: "webhook",
        gstBreakdown: gstResult,
      });
      if (newBalance > 0) {
        io.to(`tenant-${tenant_id}`).emit("wallet-restored", {
          tenant_id,
          balance: newBalance,
          status: newBalance > 100 ? "healthy" : "low",
          message: "Payment confirmed. Your account is now active.",
        });
      }
    } catch (_) {}

    logger.info(
      `[PAYMENT-WEBHOOK] GST applied: ₹${grossAmount} paid → ₹${walletCreditAmount} credited + ₹${gstAmount} GST (${webhookGstRate}%) for tenant ${tenant_id} via webhook ${eventType}`,
    );
    return { processed: true };
  }

  if (eventType === "payment.failed") {
    const pendingRecord = await db.PaymentHistory.findOne({
      where: { razorpay_order_id, status: "pending" },
    });

    if (pendingRecord) {
      await pendingRecord.update({
        razorpay_payment_id,
        status: "failed",
        metadata: {
          ...pendingRecord.metadata,
          error_code: paymentEntity.error_code,
          error_description: paymentEntity.error_description,
          failed_at: new Date().toISOString(),
        },
      });

      // Notify tenant
      try {
        const io = getIO();
        io.to(`tenant-${pendingRecord.tenant_id}`).emit("payment-failed", {
          order_id: razorpay_order_id,
          error: paymentEntity.error_description || "Payment failed",
        });
      } catch (_) {}

      logger.warn(
        `[PAYMENT-WEBHOOK] Payment failed for order ${razorpay_order_id}: ${paymentEntity.error_description}`,
      );
    }

    return { processed: true };
  }

  // Unknown event — acknowledge receipt but don't process
  return { processed: false, reason: "unhandled_event_type" };
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
      // Emit to management room only — NOT to all sockets (would expose tenant data)
      io.to("management-room").emit("payment-failure-alert", {
        tenant_id,
        invoice_number: invoice.invoice_number,
        retry_count: invoice.retry_count + 1,
      });
    } catch (_) {}

    logger.warn(
      `[PAYMENT] Max retries reached for ${invoice.invoice_number}, tenant ${tenant_id}`,
    );
  }
};
