import db from "../../database/index.js";
import { Op } from "sequelize";
import { recordHealthEvent } from "./billingHealthMonitor.js";
import { runFullWalletReconciliation } from "./walletReconciler.js";

/**
 * Run daily reconciliation:
 * 1. Wallet balance checks (via walletReconciler)
 * 2. Invoice-payment matching
 * 3. Duplicate detection
 * 4. Amount verification
 *
 * @returns {Promise<object>} Reconciliation report
 */
export const runDailyReconciliation = async () => {
  const report = {
    date: new Date().toISOString(),
    tenants_checked: 0,
    wallets_balanced: 0,
    wallet_mismatches: [],
    payment_mismatches: [],
    duplicates: [],
  };

  try {
    // 1. WALLET BALANCE CHECK
    const walletResult = await runFullWalletReconciliation();
    report.tenants_checked = walletResult.tenants_checked;
    report.wallets_balanced = walletResult.wallets_balanced;
    report.wallet_mismatches = walletResult.wallet_mismatches;

    // 2. INVOICE-PAYMENT MATCH — verify paid invoices have matching payments
    const paidInvoices = await db.MonthlyInvoices.findAll({
      where: { status: "paid" },
      attributes: [
        "id",
        "tenant_id",
        "invoice_number",
        "amount",
        "payment_reference",
      ],
      raw: true,
    });

    for (const inv of paidInvoices) {
      if (!inv.payment_reference) {
        report.payment_mismatches.push({
          type: "paid_invoice_no_payment",
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          tenant_id: inv.tenant_id,
        });
        continue;
      }

      const payment = await db.PaymentHistory.findOne({
        where: { razorpay_payment_id: inv.payment_reference },
        raw: true,
      });

      if (!payment) {
        report.payment_mismatches.push({
          type: "payment_missing",
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          payment_reference: inv.payment_reference,
          tenant_id: inv.tenant_id,
        });
      }
    }

    // 3. DUPLICATE DETECTION — check for duplicate razorpay_payment_id entries
    const [dupPayments] = await db.sequelize.query(
      `SELECT razorpay_payment_id, COUNT(*) as cnt
       FROM payment_history
       WHERE razorpay_payment_id IS NOT NULL
       GROUP BY razorpay_payment_id
       HAVING cnt > 1
       LIMIT 100`,
    );

    for (const dup of dupPayments) {
      report.duplicates.push({
        type: "duplicate_payment_id",
        razorpay_payment_id: dup.razorpay_payment_id,
        count: dup.cnt,
      });
    }

    // Check for duplicate wallet transaction references
    const [dupTxns] = await db.sequelize.query(
      `SELECT reference_id, COUNT(*) as cnt
       FROM wallet_transactions
       WHERE reference_id IS NOT NULL
       GROUP BY reference_id
       HAVING cnt > 1
       LIMIT 100`,
    );

    for (const dup of dupTxns) {
      report.duplicates.push({
        type: "duplicate_wallet_txn",
        reference_id: dup.reference_id,
        count: dup.cnt,
      });
    }

    // 4. AMOUNT VERIFICATION — for paid invoices, check payment amount matches
    for (const inv of paidInvoices) {
      if (!inv.payment_reference) continue;

      const payment = await db.PaymentHistory.findOne({
        where: { razorpay_payment_id: inv.payment_reference },
        attributes: ["amount"],
        raw: true,
      });

      if (payment) {
        const invoiceAmt = parseFloat(inv.amount);
        const paymentAmt = parseFloat(payment.amount);
        if (Math.abs(invoiceAmt - paymentAmt) > 0.01) {
          report.payment_mismatches.push({
            type: "amount_mismatch",
            invoice_id: inv.id,
            invoice_number: inv.invoice_number,
            invoice_amount: invoiceAmt,
            payment_amount: paymentAmt,
          });
        }
      }
    }

    // Store report in health table
    const hasIssues =
      report.wallet_mismatches.length > 0 ||
      report.payment_mismatches.length > 0 ||
      report.duplicates.length > 0;

    await recordHealthEvent(
      "reconciliation_report",
      null,
      hasIssues ? "Reconciliation found issues" : "Reconciliation clean",
      report,
    );

    if (hasIssues) {
      console.warn(
        "[RECONCILER] Issues found:",
        JSON.stringify({
          wallet_mismatches: report.wallet_mismatches.length,
          payment_mismatches: report.payment_mismatches.length,
          duplicates: report.duplicates.length,
        }),
      );
    } else {
      console.log(
        "[RECONCILER] Daily reconciliation passed — no issues found.",
      );
    }
  } catch (err) {
    console.error("[RECONCILER] Daily reconciliation failed:", err.message);
    await recordHealthEvent("reconciliation_mismatch", null, err.message, {
      stack: err.stack,
    });
    report.error = err.message;
  }

  return report;
};
