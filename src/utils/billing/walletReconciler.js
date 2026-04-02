import db from "../../database/index.js";
import { Op } from "sequelize";
import { recordHealthEvent } from "./billingHealthMonitor.js";

/**
 * Reconcile a single tenant's wallet balance against WalletTransactions.
 *
 * expected = SUM(credits) - SUM(debits)
 * actual   = Wallet.balance
 *
 * @param {string} tenant_id
 * @returns {Promise<{ tenant_id: string, expected: number, actual: number, difference: number, balanced: boolean }>}
 */
export const reconcileWalletBalance = async (tenant_id) => {
  try {
    const wallet = await db.Wallets.findOne({
      where: { tenant_id },
      raw: true,
    });

    if (!wallet) {
      return {
        tenant_id,
        expected: 0,
        actual: 0,
        difference: 0,
        balanced: true,
      };
    }

    const actual = parseFloat(wallet.balance) || 0;

    // Sum credits
    const creditResult = await db.WalletTransactions.findOne({
      where: { tenant_id, type: "credit" },
      attributes: [
        [db.sequelize.fn("SUM", db.sequelize.col("amount")), "total"],
      ],
      raw: true,
    });
    const totalCredits = parseFloat(creditResult?.total) || 0;

    // Sum debits
    const debitResult = await db.WalletTransactions.findOne({
      where: { tenant_id, type: "debit" },
      attributes: [
        [db.sequelize.fn("SUM", db.sequelize.col("amount")), "total"],
      ],
      raw: true,
    });
    const totalDebits = parseFloat(debitResult?.total) || 0;

    const expected = totalCredits - totalDebits;
    const difference = Math.abs(expected - actual);
    const balanced = difference < 0.01; // tolerance of 1 paisa

    if (!balanced) {
      await recordHealthEvent(
        "reconciliation_mismatch",
        tenant_id,
        `Wallet mismatch: expected ₹${expected.toFixed(4)}, actual ₹${actual.toFixed(4)}, diff ₹${difference.toFixed(4)}`,
        { expected, actual, difference, totalCredits, totalDebits },
      );

      console.warn(
        `[RECONCILER] Mismatch for tenant ${tenant_id}: expected=${expected.toFixed(4)}, actual=${actual.toFixed(4)}, diff=${difference.toFixed(4)}`,
      );
    }

    return { tenant_id, expected, actual, difference, balanced };
  } catch (err) {
    console.error(
      `[RECONCILER] Error reconciling tenant ${tenant_id}:`,
      err.message,
    );
    await recordHealthEvent("reconciliation_mismatch", tenant_id, err.message, {
      stack: err.stack,
    });
    return {
      tenant_id,
      expected: 0,
      actual: 0,
      difference: 0,
      balanced: false,
      error: err.message,
    };
  }
};

/**
 * Run reconciliation for all tenants with wallets.
 *
 * @returns {Promise<{ date: string, tenants_checked: number, wallets_balanced: number, wallet_mismatches: Array }>}
 */
export const runFullWalletReconciliation = async () => {
  const wallets = await db.Wallets.findAll({
    attributes: ["tenant_id"],
    raw: true,
  });

  const results = {
    date: new Date().toISOString(),
    tenants_checked: wallets.length,
    wallets_balanced: 0,
    wallet_mismatches: [],
  };

  for (const w of wallets) {
    const result = await reconcileWalletBalance(w.tenant_id);
    if (result.balanced) {
      results.wallets_balanced++;
    } else {
      results.wallet_mismatches.push(result);
    }
  }

  console.log(
    `[RECONCILER] Completed: ${results.tenants_checked} checked, ${results.wallets_balanced} balanced, ${results.wallet_mismatches.length} mismatches`,
  );

  return results;
};
