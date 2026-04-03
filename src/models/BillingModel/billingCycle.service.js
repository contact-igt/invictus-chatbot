import db from "../../database/index.js";
import { Op } from "sequelize";
import { getIO } from "../../middlewares/socket/socket.js";
import { recordHealthEvent } from "../../utils/billing/billingHealthMonitor.js";

/**
 * Initialize the first billing cycle for a tenant.
 * Uses transaction + row lock to prevent duplicate cycles from concurrent requests.
 * @param {string} tenant_id
 * @param {object} [existingTransaction] - Optional parent transaction to join
 */
export const initBillingCycle = async (
  tenant_id,
  existingTransaction = null,
) => {
  const perform = async (t) => {
    const existing = await db.BillingCycles.findOne({
      where: { tenant_id, status: "active" },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (existing) {
      return existing;
    }

    // Get the highest cycle_number for this tenant to continue sequence
    const lastCycle = await db.BillingCycles.findOne({
      where: { tenant_id },
      order: [["cycle_number", "DESC"]],
      attributes: ["cycle_number"],
      transaction: t,
      raw: true,
    });
    const nextCycleNumber = (lastCycle?.cycle_number || 0) + 1;

    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 30);

    const cycle = await db.BillingCycles.create(
      {
        tenant_id,
        cycle_number: nextCycleNumber,
        start_date: now,
        end_date: endDate,
        status: "active",
        total_message_cost_inr: 0,
        total_ai_cost_inr: 0,
        total_cost_inr: 0,
        is_locked: false,
      },
      { transaction: t },
    );

    // Update tenant cycle dates
    await db.Tenants.update(
      { billing_cycle_start: now, billing_cycle_end: endDate },
      { where: { tenant_id }, transaction: t },
    );

    console.log(
      `[BILLING-CYCLE] Initialized cycle #1 for tenant ${tenant_id}: ${now.toISOString()} → ${endDate.toISOString()}`,
    );
    return cycle;
  };

  if (existingTransaction) {
    return perform(existingTransaction);
  }
  return db.sequelize.transaction(perform);
};

/**
 * Get the active billing cycle for a tenant.
 * If the current cycle is expired, close it and create a new one.
 */
export const getActiveBillingCycle = async (tenant_id) => {
  let cycle = await db.BillingCycles.findOne({
    where: { tenant_id, status: "active" },
  });

  if (!cycle) {
    // No active cycle — initialize one
    cycle = await initBillingCycle(tenant_id);
    return cycle;
  }

  // Check if cycle has expired
  if (new Date(cycle.end_date) <= new Date()) {
    // Close the expired cycle and create a new one
    try {
      await closeBillingCycle(tenant_id, cycle.id);
      cycle = await db.BillingCycles.findOne({
        where: { tenant_id, status: "active" },
      });
    } catch (err) {
      console.error(
        `[BILLING-CYCLE] On-the-fly cycle close failed for tenant ${tenant_id}:`,
        err.message,
      );
      // Return the expired cycle rather than null — callers can still use it
    }
  }

  return cycle;
};

/**
 * Close a billing cycle, generate invoice, and create the next cycle.
 * Uses is_locked to prevent duplicate processing.
 * @param {string} tenant_id
 * @param {number} cycle_id
 * @param {object} [existingTransaction] - Optional parent transaction to join
 */
export const closeBillingCycle = async (
  tenant_id,
  cycle_id,
  existingTransaction = null,
) => {
  const perform = async (t) => {
    const cycle = await db.BillingCycles.findOne({
      where: { id: cycle_id, tenant_id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!cycle || cycle.status !== "active") {
      console.log(
        `[BILLING-CYCLE] Cycle ${cycle_id} already closed or not found.`,
      );
      return null;
    }

    if (cycle.is_locked) {
      console.log(`[BILLING-CYCLE] Cycle ${cycle_id} is locked, skipping.`);
      return null;
    }

    // Lock the cycle
    await cycle.update({ is_locked: true }, { transaction: t });

    try {
      // Sum BillingLedger costs linked to this billing cycle
      const ledgerSum = await db.BillingLedger.findOne({
        attributes: [
          [
            db.sequelize.fn("SUM", db.sequelize.col("total_cost_inr")),
            "totalMessageCost",
          ],
        ],
        where: {
          tenant_id,
          billing_cycle_id: cycle.id,
        },
        raw: true,
        transaction: t,
      });

      // Sum AiTokenUsage costs linked to this billing cycle
      const aiSum = await db.AiTokenUsage.findOne({
        attributes: [
          [
            db.sequelize.fn("SUM", db.sequelize.col("final_cost_inr")),
            "totalAiCost",
          ],
        ],
        where: {
          tenant_id,
          billing_cycle_id: cycle.id,
        },
        raw: true,
        transaction: t,
      });

      const totalMessageCost = parseFloat(ledgerSum?.totalMessageCost) || 0;
      const totalAiCost = parseFloat(aiSum?.totalAiCost) || 0;
      const totalCost = totalMessageCost + totalAiCost;

      // Update cycle with final totals and mark completed
      await cycle.update(
        {
          status: "completed",
          total_message_cost_inr: totalMessageCost,
          total_ai_cost_inr: totalAiCost,
          total_cost_inr: totalCost,
          is_locked: false,
        },
        { transaction: t },
      );

      // Generate invoice (idempotent) — skip if zero usage
      let invoice = null;
      if (totalCost > 0) {
        invoice = await generateMonthlyInvoice(
          tenant_id,
          cycle.id,
          {
            totalMessageCost,
            totalAiCost,
            totalCost,
            cycleEndDate: cycle.end_date,
          },
          t,
        );
      } else {
        console.log(
          `[BILLING-CYCLE] Skipping invoice for zero-usage cycle #${cycle.cycle_number}, tenant ${tenant_id}`,
        );
      }

      // Create next cycle
      const nextStart = new Date(cycle.end_date);
      const nextEnd = new Date(nextStart);
      nextEnd.setDate(nextEnd.getDate() + 30);

      await db.BillingCycles.create(
        {
          tenant_id,
          cycle_number: cycle.cycle_number + 1,
          start_date: nextStart,
          end_date: nextEnd,
          status: "active",
          total_message_cost_inr: 0,
          total_ai_cost_inr: 0,
          total_cost_inr: 0,
          is_locked: false,
        },
        { transaction: t },
      );

      // Update tenant cycle dates
      await db.Tenants.update(
        { billing_cycle_start: nextStart, billing_cycle_end: nextEnd },
        { where: { tenant_id }, transaction: t },
      );

      console.log(
        `[BILLING-CYCLE] Closed cycle #${cycle.cycle_number} for tenant ${tenant_id}: ₹${totalCost.toFixed(4)}. Next cycle: ${nextStart.toISOString()} → ${nextEnd.toISOString()}`,
      );

      return { cycle, invoice };
    } catch (err) {
      // Transaction rollback will undo the is_locked=true, no need to manually unlock
      throw err;
    }
  };

  if (existingTransaction) {
    return perform(existingTransaction);
  }
  return db.sequelize.transaction(perform);
};

/**
 * Generate a monthly invoice for a completed billing cycle.
 * Idempotent — uses findOrCreate on (tenant_id, billing_cycle_id).
 */
export const generateMonthlyInvoice = async (
  tenant_id,
  cycle_id,
  costData,
  transaction = null,
) => {
  const { totalMessageCost, totalAiCost, totalCost, cycleEndDate } = costData;

  // Due date = cycle end + 15 days
  const dueDate = new Date(cycleEndDate);
  dueDate.setDate(dueDate.getDate() + 15);

  // Generate invoice number
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
  const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;

  const opts = transaction ? { transaction } : {};

  const [invoice, created] = await db.MonthlyInvoices.findOrCreate({
    where: { tenant_id, billing_cycle_id: cycle_id },
    defaults: {
      tenant_id,
      billing_cycle_id: cycle_id,
      invoice_number: invoiceNumber,
      amount: totalCost,
      due_date: dueDate,
      status: "unpaid",
      retry_count: 0,
      breakdown: {
        messages: totalMessageCost,
        ai: totalAiCost,
        total: totalCost,
      },
    },
    ...opts,
  });

  if (created) {
    // Emit invoice-generated event
    try {
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("invoice-generated", {
        invoice_number: invoice.invoice_number,
        amount: totalCost,
        due_date: dueDate.toISOString(),
      });
    } catch (_) {}

    console.log(
      `[BILLING-CYCLE] Invoice ${invoice.invoice_number} generated for tenant ${tenant_id}: ₹${totalCost.toFixed(4)}`,
    );
  } else {
    console.log(
      `[BILLING-CYCLE] Invoice already exists for tenant ${tenant_id}, cycle ${cycle_id}. Skipping.`,
    );
  }

  return invoice;
};

/**
 * Get invoices for a tenant with optional status filter.
 */
export const getInvoicesService = async (
  tenant_id,
  status = null,
  page = 1,
  limit = 20,
) => {
  const where = {};
  if (tenant_id) where.tenant_id = tenant_id;
  if (status) where.status = status;

  const offset = (page - 1) * limit;
  const { count, rows } = await db.MonthlyInvoices.findAndCountAll({
    where,
    order: [["createdAt", "DESC"]],
    limit: parseInt(limit),
    offset,
  });

  return {
    invoices: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit),
    },
  };
};

/**
 * Get single invoice with full breakdown.
 */
export const getInvoiceDetailService = async (tenant_id, invoice_id) => {
  const where = { id: invoice_id };
  if (tenant_id) where.tenant_id = tenant_id;
  const invoice = await db.MonthlyInvoices.findOne({ where });

  if (!invoice) throw new Error("Invoice not found");

  // Get associated billing cycle
  const cycle = await db.BillingCycles.findByPk(invoice.billing_cycle_id);

  return {
    invoice,
    cycle: cycle
      ? {
          cycle_number: cycle.cycle_number,
          start_date: cycle.start_date,
          end_date: cycle.end_date,
          total_message_cost_inr: cycle.total_message_cost_inr,
          total_ai_cost_inr: cycle.total_ai_cost_inr,
          total_cost_inr: cycle.total_cost_inr,
        }
      : null,
  };
};

/**
 * Mark an invoice as paid.
 */
export const markInvoicePaid = async (invoice_id, payment_reference) => {
  const invoice = await db.MonthlyInvoices.findByPk(invoice_id);
  if (!invoice) throw new Error("Invoice not found");

  await invoice.update({
    status: "paid",
    paid_at: new Date(),
    payment_reference,
  });

  return invoice;
};

/**
 * Check if tenant has overdue invoices.
 */
export const checkOverdueInvoices = async (tenant_id) => {
  const overdueInvoices = await db.MonthlyInvoices.findAll({
    where: { tenant_id, status: "overdue" },
    raw: true,
  });

  return {
    hasOverdue: overdueInvoices.length > 0,
    overdueInvoices,
  };
};

/**
 * Check credit limit usage for a tenant.
 */
export const checkCreditLimit = async (tenant_id) => {
  const tenant = await db.Tenants.findOne({
    where: { tenant_id },
    attributes: ["postpaid_credit_limit"],
    raw: true,
  });
  const limit = parseFloat(tenant?.postpaid_credit_limit) || 5000;

  const activeCycle = await db.BillingCycles.findOne({
    where: { tenant_id, status: "active" },
    raw: true,
  });
  const usage = activeCycle ? parseFloat(activeCycle.total_cost_inr) || 0 : 0;

  return {
    withinLimit: usage < limit,
    usage,
    limit,
    percent: limit > 0 ? Math.round((usage / limit) * 100) : 0,
  };
};

// ─── CRON ──────────────────────────────────────────────────────────

/**
 * Acquire a cron lock using CronExecutionLog table.
 * Returns lock_id if acquired, null if another instance is running.
 */
const acquireCronLock = async (job_name) => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  // Check for stale locks
  const stale = await db.CronExecutionLog.findOne({
    where: {
      job_name,
      status: "running",
      started_at: { [Op.lt]: oneHourAgo },
    },
  });

  if (stale) {
    await stale.update({
      status: "failed",
      error_message: "Stale lock detected — assumed crash",
      completed_at: new Date(),
    });
    await recordHealthEvent(
      "cron_failure",
      null,
      `Stale lock for ${job_name} cleared`,
      {
        lock_id: stale.id,
      },
    );
  }

  // Check for active lock
  const active = await db.CronExecutionLog.findOne({
    where: {
      job_name,
      status: "running",
      started_at: { [Op.gte]: oneHourAgo },
    },
  });

  if (active) {
    console.log(
      `[BILLING-CRON] Lock held for ${job_name} (id: ${active.id}). Skipping.`,
    );
    return null;
  }

  // Acquire lock atomically using findOrCreate to prevent TOCTOU race
  const [lock, created] = await db.CronExecutionLog.findOrCreate({
    where: {
      job_name,
      status: "running",
      started_at: { [Op.gte]: oneHourAgo },
    },
    defaults: {
      job_name,
      status: "running",
      started_at: new Date(),
    },
  });

  if (!created) {
    console.log(
      `[BILLING-CRON] Lock race lost for ${job_name} (id: ${lock.id}). Skipping.`,
    );
    return null;
  }

  return lock.id;
};

/**
 * Release a cron lock.
 */
const releaseCronLock = async (lock_id, status, stats = {}) => {
  await db.CronExecutionLog.update(
    {
      status,
      completed_at: new Date(),
      cycles_closed: stats.cycles_closed || 0,
      invoices_generated: stats.invoices_generated || 0,
      overdue_marked: stats.overdue_marked || 0,
      error_message: stats.error_message || null,
    },
    { where: { id: lock_id } },
  );
};

/**
 * Daily billing cycle cron job.
 * Closes expired cycles, generates invoices, marks overdue invoices.
 */
export const runBillingCycleCron = async () => {
  let lockId = null;

  try {
    lockId = await acquireCronLock("billing_cycle_cron");
    if (!lockId) return;

    const stats = {
      cycles_closed: 0,
      invoices_generated: 0,
      overdue_marked: 0,
    };

    // 1. Close expired active cycles
    const expiredCycles = await db.BillingCycles.findAll({
      where: {
        end_date: { [Op.lte]: new Date() },
        status: "active",
        is_locked: false,
      },
    });

    for (const cycle of expiredCycles) {
      try {
        const result = await closeBillingCycle(cycle.tenant_id, cycle.id);
        if (result) {
          stats.cycles_closed++;
          if (result.invoice) stats.invoices_generated++;
        }
      } catch (err) {
        console.error(
          `[BILLING-CRON] Error closing cycle ${cycle.id}:`,
          err.message,
        );
        await recordHealthEvent(
          "cron_failure",
          cycle.tenant_id,
          `Cycle close failed: ${err.message}`,
          {
            cycle_id: cycle.id,
          },
        );
      }
    }

    // 2. Mark overdue invoices
    const now = new Date();
    const [overdueCount] = await db.MonthlyInvoices.update(
      { status: "overdue" },
      {
        where: {
          status: "unpaid",
          due_date: { [Op.lt]: now },
        },
      },
    );
    stats.overdue_marked = overdueCount;

    // Emit overdue alerts only for newly marked invoices
    if (overdueCount > 0) {
      const newlyOverdueInvoices = await db.MonthlyInvoices.findAll({
        where: {
          status: "overdue",
          updatedAt: { [Op.gte]: new Date(now.getTime() - 60000) }, // Updated within the last minute
        },
        attributes: ["tenant_id", "invoice_number", "amount", "due_date"],
        raw: true,
      });

      try {
        const io = getIO();
        for (const inv of newlyOverdueInvoices) {
          const daysOverdue = Math.ceil(
            (Date.now() - new Date(inv.due_date).getTime()) /
              (1000 * 60 * 60 * 24),
          );
          io.to(`tenant-${inv.tenant_id}`).emit("invoice-overdue", {
            invoice_number: inv.invoice_number,
            amount: parseFloat(inv.amount),
            days_overdue: daysOverdue,
          });
        }
      } catch (_) {}
    }

    await releaseCronLock(lockId, "completed", stats);

    console.log(
      `[BILLING-CRON] Completed: ${stats.cycles_closed} cycles closed, ${stats.invoices_generated} invoices generated, ${stats.overdue_marked} marked overdue.`,
    );
  } catch (error) {
    console.error("[BILLING-CRON] Failed:", error.message);
    if (lockId) {
      await releaseCronLock(lockId, "failed", { error_message: error.message });
    }
    await recordHealthEvent("cron_failure", null, error.message, {
      stack: error.stack,
    });

    // One automatic retry after 5 minutes
    setTimeout(
      () => {
        console.log("[BILLING-CRON] Retrying after failure...");
        runBillingCycleCron();
      },
      5 * 60 * 1000,
    );
  }
};
