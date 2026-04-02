import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";

/**
 * Wallet Status Levels — NO grace/suspended, NO negative balance
 */
export const WALLET_STATUS = {
  HEALTHY: "healthy", // Balance > ₹100
  LOW: "low", // ₹0 < balance ≤ ₹100
  ZERO: "zero", // balance = 0
};

const THRESHOLDS = {
  LOW_BALANCE: 100,
};

// Retry configuration for lock conflicts
const MAX_WALLET_RETRIES = 3;
const RETRY_BASE_DELAY = 100; // ms

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isLockConflict = (err) =>
  err.name === "SequelizeDatabaseError" &&
  (err.original?.code === "ER_LOCK_WAIT_TIMEOUT" ||
    err.original?.code === "ER_LOCK_DEADLOCK" ||
    err.original?.errno === 1205 ||
    err.original?.errno === 1213);

/**
 * Check wallet status for a tenant (no grace/negative logic).
 */
export const checkWalletStatus = async (tenant_id) => {
  try {
    const wallet = await db.Wallets.findOne({ where: { tenant_id } });

    if (!wallet) {
      const [newWallet] = await db.Wallets.findOrCreate({
        where: { tenant_id },
        defaults: { tenant_id, balance: 0, currency: "INR" },
      });
      const newBalance = parseFloat(newWallet.balance) || 0;
      return {
        status: newBalance > 0 ? WALLET_STATUS.HEALTHY : WALLET_STATUS.ZERO,
        balance: newBalance,
        billing_mode: "prepaid",
        message:
          newBalance > 0
            ? "Wallet is healthy."
            : "Wallet created. Please add funds to continue using services.",
      };
    }

    const balance = parseFloat(wallet.balance) || 0;
    let status;
    let message;

    if (balance > THRESHOLDS.LOW_BALANCE) {
      status = WALLET_STATUS.HEALTHY;
      message = "Wallet is healthy.";
    } else if (balance > 0) {
      status = WALLET_STATUS.LOW;
      message = `Low balance (₹${balance.toFixed(2)}). Please recharge soon.`;
    } else {
      status = WALLET_STATUS.ZERO;
      message = "Wallet balance is zero. Please recharge to continue.";
    }

    // Fetch billing_mode from tenant
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["billing_mode"],
      raw: true,
    });

    return {
      status,
      balance,
      billing_mode: tenant?.billing_mode || "prepaid",
      message,
      autoRechargeEnabled: wallet.auto_recharge_enabled || false,
      autoRechargeThreshold: wallet.auto_recharge_threshold || 100,
      autoRechargeAmount: wallet.auto_recharge_amount || 500,
    };
  } catch (error) {
    console.error(
      "[WALLET-GUARD] Error checking wallet status:",
      error.message,
    );
    return {
      status: WALLET_STATUS.HEALTHY,
      balance: 0,
      billing_mode: "prepaid",
      message: "Unable to verify wallet status.",
      error: true,
    };
  }
};

/**
 * CORE PREPAID VALIDATION — check if tenant can afford a specific cost.
 * Rule: allowed = (balance >= required_cost)
 *
 * @param {string} tenant_id
 * @param {number} required_cost - Must be calculated by caller, NEVER defaults to 0
 * @returns {Promise<{ allowed: boolean, balance: number, required: number, shortfall: number }>}
 */
export const canAfford = async (tenant_id, required_cost) => {
  const wallet = await db.Wallets.findOne({ where: { tenant_id } });
  const balance = wallet ? parseFloat(wallet.balance) || 0 : 0;

  if (balance >= required_cost) {
    return { allowed: true, balance, required: required_cost, shortfall: 0 };
  }

  return {
    allowed: false,
    balance,
    required: required_cost,
    shortfall: required_cost - balance,
  };
};

/**
 * Check postpaid access — overdue invoices OR credit limit exceeded blocks usage.
 *
 * @param {string} tenant_id
 * @param {number} estimated_cost - Estimated cost of the current operation
 * @returns {Promise<{ allowed: boolean, reason?: string, usage?: number, limit?: number }>}
 */
export const checkPostpaidAccess = async (tenant_id, estimated_cost = 0) => {
  // 1. Check overdue invoices AND unpaid invoices past due date (real-time check)
  const overdueInvoice = await db.MonthlyInvoices.findOne({
    where: {
      tenant_id,
      [db.Sequelize.Op.or]: [
        { status: "overdue" },
        {
          status: "unpaid",
          due_date: { [db.Sequelize.Op.lt]: new Date() },
        },
      ],
    },
  });

  if (overdueInvoice) {
    return {
      allowed: false,
      reason: "You have an unpaid overdue invoice. Please pay to continue.",
      invoice_number: overdueInvoice.invoice_number,
    };
  }

  // 2. Check credit limit
  const tenant = await db.Tenants.findOne({
    where: { tenant_id },
    attributes: ["postpaid_credit_limit"],
    raw: true,
  });
  const creditLimit = parseFloat(tenant?.postpaid_credit_limit) || 5000;

  const activeCycle = await db.BillingCycles.findOne({
    where: { tenant_id, status: "active" },
    raw: true,
  });

  const currentUsage = activeCycle
    ? parseFloat(activeCycle.total_cost_inr) || 0
    : 0;

  if (currentUsage + estimated_cost > creditLimit) {
    return {
      allowed: false,
      reason: `Monthly credit limit of ₹${creditLimit.toFixed(2)} would be exceeded.`,
      usage: currentUsage,
      limit: creditLimit,
    };
  }

  // Emit 80% warning (but still allow)
  if (currentUsage >= creditLimit * 0.8) {
    try {
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("credit-limit-warning", {
        usage: currentUsage,
        limit: creditLimit,
        percent: Math.round((currentUsage / creditLimit) * 100),
      });
    } catch (_) {}
  }

  return { allowed: true, usage: currentUsage, limit: creditLimit };
};

/**
 * Unified check — routes to prepaid or postpaid logic.
 *
 * @param {string} tenant_id
 * @param {number} estimated_cost - REQUIRED. Caller must compute this.
 * @returns {Promise<{ allowed: boolean, billing_mode: string, reason?: string, balance?: number, required?: number, shortfall?: number }>}
 */
export const canSendMessage = async (tenant_id, estimated_cost) => {
  const tenant = await db.Tenants.findOne({
    where: { tenant_id },
    attributes: ["billing_mode"],
    raw: true,
  });
  const billing_mode = tenant?.billing_mode || "prepaid";

  if (billing_mode === "postpaid") {
    const result = await checkPostpaidAccess(tenant_id, estimated_cost);
    return { ...result, billing_mode };
  }

  // Prepaid
  const result = await canAfford(tenant_id, estimated_cost);
  if (result.allowed) {
    return { allowed: true, billing_mode, balance: result.balance };
  }

  return {
    allowed: false,
    billing_mode,
    reason: `Insufficient balance. Required: ₹${estimated_cost.toFixed(2)}, Available: ₹${result.balance.toFixed(2)}`,
    balance: result.balance,
    required: result.required,
    shortfall: result.shortfall,
  };
};

/**
 * Check if tenant can use AI features.
 */
export const canUseAI = async (tenant_id, estimated_cost) => {
  return canSendMessage(tenant_id, estimated_cost);
};

/**
 * Check if tenant can send campaigns.
 */
export const canSendCampaign = async (tenant_id, estimated_total_cost) => {
  return canSendMessage(tenant_id, estimated_total_cost);
};

/**
 * Get the suspension fallback message for customers.
 */
export const getSuspensionMessage = async (tenant_id) => {
  try {
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["company_name", "phone", "email"],
    });

    const companyName = tenant?.company_name || "our team";
    const phone = tenant?.phone;

    if (phone) {
      return `We're temporarily unable to respond automatically. ${companyName} will contact you shortly. For urgent matters, please call: ${phone}`;
    }

    return `We're temporarily unable to respond automatically. ${companyName} will contact you shortly.`;
  } catch (error) {
    return "We're temporarily unable to respond. Our team will contact you shortly.";
  }
};

/**
 * Deduct from wallet atomically with FOR UPDATE row lock and retry on conflict.
 *
 * @param {string} tenant_id
 * @param {number} cost       - Amount to deduct (INR)
 * @param {string} reference_id
 * @param {string} description
 * @param {object} [existingTransaction] - Existing Sequelize transaction to join
 * @returns {Promise<{ success: boolean, oldBalance: number, newBalance: number, error?: string }>}
 */
export const deductWallet = async (
  tenant_id,
  cost,
  reference_id,
  description,
  existingTransaction = null,
) => {
  let retries = 0;

  const attemptDeduction = async () => {
    const performDeduction = async (t) => {
      // Row-level lock
      const wallet = await db.Wallets.findOne({
        where: { tenant_id },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!wallet) {
        return {
          success: false,
          oldBalance: 0,
          newBalance: 0,
          error: "Wallet not found",
        };
      }

      const oldBalance = parseFloat(wallet.balance) || 0;

      if (oldBalance < cost) {
        return {
          success: false,
          oldBalance,
          newBalance: oldBalance,
          error: "Insufficient balance",
          shortfall: cost - oldBalance,
        };
      }

      const newBalance = oldBalance - cost;
      await wallet.update({ balance: newBalance }, { transaction: t });

      await db.WalletTransactions.create(
        {
          tenant_id,
          type: "debit",
          amount: cost,
          reference_id,
          description,
          balance_after: newBalance,
        },
        { transaction: t },
      );

      return { success: true, oldBalance, newBalance };
    };

    if (existingTransaction) {
      return performDeduction(existingTransaction);
    }
    return db.sequelize.transaction(performDeduction);
  };

  while (retries <= MAX_WALLET_RETRIES) {
    try {
      const result = await attemptDeduction();

      // Post-deduction alerts
      if (result.success) {
        try {
          const io = getIO();
          if (
            result.newBalance < THRESHOLDS.LOW_BALANCE &&
            result.newBalance > 0
          ) {
            io.to(`tenant-${tenant_id}`).emit("low-balance-warning", {
              balance: result.newBalance,
              message: `Low balance (₹${result.newBalance.toFixed(2)}). Please recharge soon.`,
            });
          }
          if (result.newBalance === 0) {
            io.to(`tenant-${tenant_id}`).emit("zero-balance", {
              balance: 0,
              message: "Wallet balance is zero. Please recharge to continue.",
            });
          }
        } catch (_) {}
      }

      return result;
    } catch (err) {
      if (isLockConflict(err) && retries < MAX_WALLET_RETRIES) {
        retries++;
        const delay = RETRY_BASE_DELAY * Math.pow(2, retries - 1);
        console.warn(
          `[WALLET-GUARD] Lock conflict for tenant ${tenant_id}, retry ${retries}/${MAX_WALLET_RETRIES} in ${delay}ms`,
        );
        await sleep(delay);
        continue;
      }

      console.error(
        `[WALLET-GUARD] Wallet deduction failed for tenant ${tenant_id}:`,
        err.message,
      );
      try {
        const io = getIO();
        io.to(`tenant-${tenant_id}`).emit("billing-error", {
          reason: "Transaction conflict. Please try again.",
        });
      } catch (_) {}

      return {
        success: false,
        oldBalance: 0,
        newBalance: 0,
        error: err.message,
      };
    }
  }

  return {
    success: false,
    oldBalance: 0,
    newBalance: 0,
    error: "Max retries exceeded",
  };
};

/**
 * Emit wallet warnings — simplified version (no grace/suspension).
 */
export const emitWalletWarning = async (tenant_id, status, balance) => {
  try {
    const io = getIO();

    if (status === WALLET_STATUS.ZERO) {
      io.to(`tenant-${tenant_id}`).emit("zero-balance", {
        tenant_id,
        balance: 0,
        status,
        message:
          "Wallet balance is zero. Please recharge to continue services.",
      });
    } else if (status === WALLET_STATUS.LOW) {
      io.to(`tenant-${tenant_id}`).emit("low-balance-warning", {
        tenant_id,
        balance,
        status,
        message: `Low balance (₹${balance.toFixed(2)}). Please recharge soon.`,
      });
    }
  } catch (error) {
    console.error("[WALLET-GUARD] Error emitting warning:", error.message);
  }
};
