import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";
import { initBillingCycle, closeBillingCycle } from "./billingCycle.service.js";

/**
 * Force unlock access for a tenant.
 * Resets overdue invoices to 'unpaid' and unlocks locked cycles.
 */
export const forceUnlockAccess = async (admin_id, tenant_id, reason) => {
  if (!reason) throw new Error("Reason is required for force unlock");

  // Capture before state
  const overdueInvoices = await db.MonthlyInvoices.findAll({
    where: { tenant_id, status: "overdue" },
    attributes: ["id", "invoice_number", "status"],
    raw: true,
  });

  const lockedCycles = await db.BillingCycles.findAll({
    where: { tenant_id, is_locked: true },
    attributes: ["id", "cycle_number", "is_locked"],
    raw: true,
  });

  // Reset overdue invoices to unpaid
  await db.MonthlyInvoices.update(
    { status: "unpaid" },
    { where: { tenant_id, status: "overdue" } },
  );

  // Unlock locked cycles
  await db.BillingCycles.update(
    { is_locked: false },
    { where: { tenant_id, is_locked: true } },
  );

  // Audit log
  await db.AdminAuditLog.create({
    admin_id,
    tenant_id,
    action_type: "force_unlock",
    details: {
      overdue_invoices_reset: overdueInvoices.length,
      locked_cycles_unlocked: lockedCycles.length,
    },
    before_state: { overdueInvoices, lockedCycles },
    after_state: { all_invoices_unpaid: true, all_cycles_unlocked: true },
    reason,
  });

  // Emit access-restored event
  try {
    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("access-restored", { tenant_id });
  } catch (_) {}

  console.log(
    `[ADMIN-BILLING] force_unlock by ${admin_id} for tenant ${tenant_id}: ${reason}`,
  );

  return {
    success: true,
    overdue_invoices_reset: overdueInvoices.length,
    locked_cycles_unlocked: lockedCycles.length,
  };
};

/**
 * Manually credit a tenant's wallet.
 */
export const manualWalletCredit = async (
  admin_id,
  tenant_id,
  amount,
  reason,
) => {
  if (!amount || amount <= 0) throw new Error("Amount must be positive");
  if (!reason) throw new Error("Reason is required for manual credit");

  const amountInRupees = parseFloat(amount);
  let oldBalance, newBalance;

  await db.sequelize.transaction(async (t) => {
    let [wallet] = await db.Wallets.findOrCreate({
      where: { tenant_id },
      defaults: { tenant_id, balance: 0, currency: "INR" },
      transaction: t,
    });

    oldBalance = parseFloat(wallet.balance) || 0;
    newBalance = oldBalance + amountInRupees;

    await wallet.update({ balance: newBalance }, { transaction: t });

    await db.WalletTransactions.create(
      {
        tenant_id,
        type: "credit",
        amount: amountInRupees,
        reference_id: `admin_credit_${admin_id}_${Date.now()}`,
        description: `Admin manual credit: ${reason}`,
        balance_after: newBalance,
      },
      { transaction: t },
    );
  });

  // Audit log
  await db.AdminAuditLog.create({
    admin_id,
    tenant_id,
    action_type: "manual_credit",
    details: { amount: amountInRupees },
    before_state: { balance: oldBalance },
    after_state: { balance: newBalance },
    reason,
  });

  // Emit socket
  try {
    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("payment-update", {
      type: "ADMIN_CREDIT",
      amount: amountInRupees,
      balance: newBalance,
      message: `₹${amountInRupees.toFixed(2)} credited: ${reason}`,
    });
  } catch (_) {}

  console.log(
    `[ADMIN-BILLING] manual_credit by ${admin_id}: ₹${amountInRupees.toFixed(2)} to tenant ${tenant_id}. Reason: ${reason}`,
  );

  return { success: true, amount: amountInRupees, oldBalance, newBalance };
};

/**
 * Manually close/cancel an invoice.
 */
export const manualInvoiceClose = async (admin_id, invoice_id, reason) => {
  if (!reason) throw new Error("Reason is required for invoice cancellation");

  const invoice = await db.MonthlyInvoices.findByPk(invoice_id);
  if (!invoice) throw new Error("Invoice not found");

  const beforeState = {
    status: invoice.status,
    invoice_number: invoice.invoice_number,
    amount: parseFloat(invoice.amount),
  };

  await invoice.update({ status: "cancelled" });

  // Audit log
  await db.AdminAuditLog.create({
    admin_id,
    tenant_id: invoice.tenant_id,
    action_type: "manual_invoice_close",
    details: {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
    },
    before_state: beforeState,
    after_state: { status: "cancelled" },
    reason,
  });

  console.log(
    `[ADMIN-BILLING] manual_invoice_close by ${admin_id}: ${invoice.invoice_number}. Reason: ${reason}`,
  );

  return { success: true, invoice_number: invoice.invoice_number };
};

/**
 * Change a tenant's billing mode (prepaid ↔ postpaid).
 */
export const changeBillingMode = async (
  admin_id,
  tenant_id,
  new_mode,
  reason,
) => {
  if (!["prepaid", "postpaid"].includes(new_mode)) {
    throw new Error("Invalid billing mode. Must be 'prepaid' or 'postpaid'.");
  }
  if (!reason) throw new Error("Reason is required for billing mode change");

  const tenant = await db.Tenants.findOne({ where: { tenant_id } });
  if (!tenant) throw new Error("Tenant not found");

  const old_mode = tenant.billing_mode || "prepaid";

  if (old_mode === new_mode) {
    return { success: true, message: `Already in ${new_mode} mode` };
  }

  await db.sequelize.transaction(async (t) => {
    // Switch to postpaid → initialize billing cycle + set credit limit
    if (new_mode === "postpaid") {
      await initBillingCycle(tenant_id);
      await tenant.update(
        {
          billing_mode: new_mode,
          postpaid_credit_limit:
            parseFloat(tenant.postpaid_credit_limit) || 5000,
        },
        { transaction: t },
      );
    }

    // Switch to prepaid → close active cycle + generate final invoice + cleanup
    if (new_mode === "prepaid") {
      const activeCycle = await db.BillingCycles.findOne({
        where: { tenant_id, status: "active" },
        transaction: t,
      });
      if (activeCycle) {
        await closeBillingCycle(tenant_id, activeCycle.id);

        // Delete the auto-created next cycle since we're leaving postpaid
        await db.BillingCycles.destroy({
          where: { tenant_id, status: "active" },
          transaction: t,
        });
      }

      // Clear stale cycle dates and switch mode
      await tenant.update(
        {
          billing_mode: new_mode,
          billing_cycle_start: null,
          billing_cycle_end: null,
        },
        { transaction: t },
      );
    }
  });

  // Audit log
  await db.AdminAuditLog.create({
    admin_id,
    tenant_id,
    action_type: "billing_mode_change",
    details: { old_mode, new_mode },
    before_state: { billing_mode: old_mode },
    after_state: { billing_mode: new_mode },
    reason,
  });

  console.log(
    `[ADMIN-BILLING] billing_mode_change by ${admin_id}: ${old_mode} → ${new_mode} for tenant ${tenant_id}. Reason: ${reason}`,
  );

  return { success: true, old_mode, new_mode };
};

/**
 * Get admin audit log entries.
 */
export const getAuditLogService = async (
  tenant_id = null,
  page = 1,
  limit = 50,
) => {
  const where = {};
  if (tenant_id) where.tenant_id = tenant_id;

  const offset = (page - 1) * limit;
  const { count, rows } = await db.AdminAuditLog.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: parseInt(limit),
    offset,
  });

  return {
    logs: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit),
    },
  };
};
