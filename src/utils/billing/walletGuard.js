import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";

/**
 * Wallet Status Levels
 */
export const WALLET_STATUS = {
  HEALTHY: "healthy", // Balance > ₹100
  LOW: "low", // Balance ₹0 - ₹100
  GRACE: "grace", // Balance -₹50 to ₹0 (24h grace period)
  SUSPENDED: "suspended", // Balance < -₹50
};

/**
 * Thresholds for wallet status
 */
const THRESHOLDS = {
  LOW_BALANCE: 100, // Below this = LOW status
  GRACE_LIMIT: 0, // Below this = GRACE status
  SUSPENSION_LIMIT: -50, // Below this = SUSPENDED
};

/**
 * Check wallet status for a tenant
 * @param {string} tenant_id
 * @returns {Promise<{status: string, balance: number, canSendMessages: boolean, canUseCampaigns: boolean, canUseAI: boolean, gracePeriodEnds?: Date}>}
 */
export const checkWalletStatus = async (tenant_id) => {
  try {
    const wallet = await db.Wallets.findOne({ where: { tenant_id } });

    if (!wallet) {
      // No wallet = new tenant, create one with 0 balance
      const [newWallet] = await db.Wallets.findOrCreate({
        where: { tenant_id },
        defaults: { tenant_id, balance: 0, currency: "INR" },
      });
      return {
        status: WALLET_STATUS.GRACE,
        balance: 0,
        canSendMessages: true,
        canUseCampaigns: false,
        canUseAI: true,
        message: "Wallet created. Please add funds to continue using services.",
      };
    }

    const balance = parseFloat(wallet.balance);
    let status;
    let canSendMessages = true;
    let canUseCampaigns = true;
    let canUseAI = true;
    let message = "";

    if (balance > THRESHOLDS.LOW_BALANCE) {
      status = WALLET_STATUS.HEALTHY;
      message = "Wallet is healthy.";
    } else if (balance > THRESHOLDS.GRACE_LIMIT) {
      status = WALLET_STATUS.LOW;
      message = `Low balance (₹${balance.toFixed(2)}). Please recharge soon.`;
    } else if (balance > THRESHOLDS.SUSPENSION_LIMIT) {
      status = WALLET_STATUS.GRACE;
      canUseCampaigns = false;
      message = `Grace period active. Balance: ₹${balance.toFixed(2)}. Campaigns blocked.`;
    } else {
      status = WALLET_STATUS.SUSPENDED;
      canSendMessages = false;
      canUseCampaigns = false;
      canUseAI = false;
      message = `Account suspended. Balance: ₹${balance.toFixed(2)}. Please recharge immediately.`;
    }

    return {
      status,
      balance,
      canSendMessages,
      canUseCampaigns,
      canUseAI,
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
    // On error, allow services to continue (fail-open for availability)
    return {
      status: WALLET_STATUS.HEALTHY,
      balance: 0,
      canSendMessages: true,
      canUseCampaigns: true,
      canUseAI: true,
      message: "Unable to verify wallet status.",
      error: true,
    };
  }
};

/**
 * Check if tenant can send messages (AI or Admin)
 * @param {string} tenant_id
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export const canSendMessage = async (tenant_id) => {
  const walletStatus = await checkWalletStatus(tenant_id);

  if (walletStatus.canSendMessages) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: walletStatus.message,
    status: walletStatus.status,
    balance: walletStatus.balance,
  };
};

/**
 * Check if tenant can use AI features
 * @param {string} tenant_id
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export const canUseAI = async (tenant_id) => {
  const walletStatus = await checkWalletStatus(tenant_id);

  if (walletStatus.canUseAI) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: walletStatus.message,
    status: walletStatus.status,
    balance: walletStatus.balance,
  };
};

/**
 * Check if tenant can send campaigns
 * @param {string} tenant_id
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export const canSendCampaign = async (tenant_id) => {
  const walletStatus = await checkWalletStatus(tenant_id);

  if (walletStatus.canUseCampaigns) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: walletStatus.message,
    status: walletStatus.status,
    balance: walletStatus.balance,
  };
};

/**
 * Get the suspension fallback message for customers
 * @param {string} tenant_id
 * @returns {Promise<string>}
 */
export const getSuspensionMessage = async (tenant_id) => {
  try {
    // Try to get tenant's contact info for the message
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
 * Restore wallet status after successful payment
 * Called by payment verification service
 * @param {string} tenant_id
 * @param {number} newBalance
 */
export const checkAndRestoreWallet = async (tenant_id, newBalance) => {
  try {
    if (newBalance > THRESHOLDS.GRACE_LIMIT) {
      // Balance is positive, restore services
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("wallet-restored", {
        tenant_id,
        balance: newBalance,
        status:
          newBalance > THRESHOLDS.LOW_BALANCE
            ? WALLET_STATUS.HEALTHY
            : WALLET_STATUS.LOW,
        message: "Services restored! Your account is now active.",
      });

      console.log(
        `[WALLET-GUARD] Tenant ${tenant_id} restored. Balance: ₹${newBalance.toFixed(2)}`,
      );
      return true;
    }
    return false;
  } catch (error) {
    console.error("[WALLET-GUARD] Error restoring wallet:", error.message);
    return false;
  }
};

/**
 * Emit suspension warning to tenant dashboard
 * @param {string} tenant_id
 * @param {string} status
 * @param {number} balance
 */
export const emitWalletWarning = async (tenant_id, status, balance) => {
  try {
    const io = getIO();

    if (status === WALLET_STATUS.SUSPENDED) {
      io.to(`tenant-${tenant_id}`).emit("wallet-suspended", {
        tenant_id,
        balance,
        status,
        message:
          "Account suspended. Please recharge immediately to restore services.",
      });
    } else if (status === WALLET_STATUS.GRACE) {
      io.to(`tenant-${tenant_id}`).emit("wallet-grace", {
        tenant_id,
        balance,
        status,
        message:
          "Grace period active. Campaigns are blocked. Please recharge soon.",
      });
    }
  } catch (error) {
    console.error("[WALLET-GUARD] Error emitting warning:", error.message);
  }
};
