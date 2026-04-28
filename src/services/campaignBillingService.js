/**
 * Campaign Billing Service
 *
 * Provides atomic billing reservations to prevent overspending across concurrent
 * campaign dispatches. Uses Redis to reserve wallet balance before processing.
 */
import { logger } from "../utils/logger.js";
import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";

export class CampaignBillingService {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  /**
   * Create an atomic billing reservation
   * @param {string} tenantId - Tenant ID
   * @param {number} amount - Amount to reserve (in INR)
   * @param {number} ttl - Reservation TTL in seconds (default: 300 = 5 min)
   * @returns {Promise<{success: boolean, reservationId?: string, reason?: string}>}
   */
  async createReservation(tenantId, amount, ttl = 300) {
    try {
      const reservationId = `billing_reservation:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;

      // Get current wallet balance
      const wallet = await db.TenantWallets.findOne({
        where: { tenant_id: tenantId },
        attributes: ["balance_inr", "is_active"],
        raw: true,
      });

      if (!wallet) {
        return {
          success: false,
          reason: "Wallet not found",
        };
      }

      if (!wallet.is_active) {
        return {
          success: false,
          reason: "Wallet is inactive",
        };
      }

      if (wallet.balance_inr < amount) {
        return {
          success: false,
          reason: `Insufficient balance. Required: ₹${amount}, Available: ₹${wallet.balance_inr}`,
        };
      }

      // Atomic reservation: check balance and deduct in one operation
      const script = `
        local balance = redis.call('get', KEYS[1])
        if not balance then
          return {0, 'wallet_not_found'}
        end

        balance = tonumber(balance)
        local reserveAmount = tonumber(ARGV[1])

        if balance < reserveAmount then
          return {0, 'insufficient_balance', balance}
        end

        redis.call('decrbyfloat', KEYS[1], reserveAmount)
        redis.call('setex', KEYS[2], ARGV[2], ARGV[1])

        return {1, balance - reserveAmount}
      `;

      const walletKey = `wallet:balance:${tenantId}`;
      const reservationKey = `reservation:${reservationId}`;

      const result = await this.redis.eval(
        script,
        2,
        walletKey,
        reservationKey,
        amount.toString(),
        ttl.toString(),
      );

      const [success, ...data] = result;

      if (success === 1) {
        logger.info(
          `[BILLING] Reservation created: ${reservationId} for tenant ${tenantId}, amount: ₹${amount}`,
        );
        return {
          success: true,
          reservationId,
          newBalance: parseFloat(data[0]),
        };
      } else {
        const reason = data[0];
        let errorReason = "Unknown error";

        if (reason === "wallet_not_found") {
          errorReason = "Wallet not found in cache";
        } else if (reason === "insufficient_balance") {
          errorReason = `Insufficient balance. Available: ₹${data[1]}`;
        }

        return {
          success: false,
          reason: errorReason,
        };
      }
    } catch (err) {
      logger.error(
        `[BILLING] Failed to create reservation for tenant ${tenantId}: ${err.message}`,
      );
      return {
        success: false,
        reason: "Reservation creation failed",
      };
    }
  }

  /**
   * Release a billing reservation (refund the amount)
   * @param {string} tenantId - Tenant ID
   * @param {string} reservationId - Reservation ID
   * @returns {Promise<boolean>}
   */
  async releaseReservation(tenantId, reservationId) {
    try {
      const reservationKey = `reservation:${reservationId}`;
      const walletKey = `wallet:balance:${tenantId}`;

      // Get reserved amount and delete reservation atomically
      const script = `
        local reservedAmount = redis.call('get', KEYS[1])
        if not reservedAmount then
          return 0
        end

        redis.call('del', KEYS[1])
        redis.call('incrbyfloat', KEYS[2], reservedAmount)

        return reservedAmount
      `;

      const result = await this.redis.eval(
        script,
        2,
        reservationKey,
        walletKey,
      );

      if (result !== 0) {
        logger.info(
          `[BILLING] Reservation released: ${reservationId} for tenant ${tenantId}, amount: ₹${result}`,
        );
        return true;
      } else {
        logger.warn(
          `[BILLING] Reservation not found or already released: ${reservationId}`,
        );
        return false;
      }
    } catch (err) {
      logger.error(
        `[BILLING] Failed to release reservation ${reservationId}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Confirm a billing reservation (convert to actual deduction)
   * @param {string} tenantId - Tenant ID
   * @param {string} reservationId - Reservation ID
   * @returns {Promise<boolean>}
   */
  async confirmReservation(tenantId, reservationId) {
    try {
      const reservationKey = `reservation:${reservationId}`;

      // Just delete the reservation - amount is already deducted
      const deleted = await this.redis.del(reservationKey);

      if (deleted === 1) {
        logger.info(
          `[BILLING] Reservation confirmed: ${reservationId} for tenant ${tenantId}`,
        );
        return true;
      } else {
        logger.warn(
          `[BILLING] Reservation not found for confirmation: ${reservationId}`,
        );
        return false;
      }
    } catch (err) {
      logger.error(
        `[BILLING] Failed to confirm reservation ${reservationId}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Sync wallet balance from database to Redis cache
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<boolean>}
   */
  async syncWalletBalance(tenantId) {
    try {
      const wallet = await db.TenantWallets.findOne({
        where: { tenant_id: tenantId },
        attributes: ["balance_inr"],
        raw: true,
      });

      if (!wallet) {
        logger.warn(`[BILLING] Wallet not found for tenant ${tenantId}`);
        return false;
      }

      const walletKey = `wallet:balance:${tenantId}`;
      await this.redis.set(walletKey, wallet.balance_inr.toString());

      logger.debug(
        `[BILLING] Wallet balance synced for tenant ${tenantId}: ₹${wallet.balance_inr}`,
      );
      return true;
    } catch (err) {
      logger.error(
        `[BILLING] Failed to sync wallet balance for tenant ${tenantId}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Get current wallet balance from cache
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<number|null>}
   */
  async getCachedBalance(tenantId) {
    try {
      const walletKey = `wallet:balance:${tenantId}`;
      const balance = await this.redis.get(walletKey);

      return balance ? parseFloat(balance) : null;
    } catch (err) {
      logger.warn(
        `[BILLING] Failed to get cached balance for tenant ${tenantId}: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Check if tenant can afford a campaign
   * @param {string} tenantId - Tenant ID
   * @param {number} amount - Amount required
   * @returns {Promise<{allowed: boolean, reason?: string, balance?: number}>}
   */
  async canAffordCampaign(tenantId, amount) {
    try {
      // Try cache first
      let balance = await this.getCachedBalance(tenantId);

      if (balance === null) {
        // Sync from database
        await this.syncWalletBalance(tenantId);
        balance = await this.getCachedBalance(tenantId);
      }

      if (balance === null) {
        return {
          allowed: false,
          reason: "Unable to retrieve wallet balance",
        };
      }

      if (balance >= amount) {
        return {
          allowed: true,
          balance,
        };
      } else {
        return {
          allowed: false,
          reason: `Insufficient balance. Required: ₹${amount}, Available: ₹${balance}`,
          balance,
        };
      }
    } catch (err) {
      logger.error(
        `[BILLING] Failed to check affordability for tenant ${tenantId}: ${err.message}`,
      );
      return {
        allowed: false,
        reason: "Balance check failed",
      };
    }
  }

  /**
   * Get billing statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      const reservationKeys = await this.redis.keys("reservation:*");
      const walletKeys = await this.redis.keys("wallet:balance:*");

      return {
        activeReservations: reservationKeys.length,
        cachedWallets: walletKeys.length,
        reservations: reservationKeys.slice(0, 5), // Sample
        wallets: walletKeys.slice(0, 5), // Sample
      };
    } catch (err) {
      logger.warn(`[BILLING] Failed to get billing stats: ${err.message}`);
      return { error: err.message };
    }
  }
}

// Export singleton instance
let campaignBillingServiceInstance = null;

export const getCampaignBillingService = (redisClient) => {
  if (!campaignBillingServiceInstance && redisClient) {
    campaignBillingServiceInstance = new CampaignBillingService(redisClient);
  }
  return campaignBillingServiceInstance;
};
