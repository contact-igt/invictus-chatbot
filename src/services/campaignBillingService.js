/**
 * Campaign Billing Service
 *
 * Provides atomic billing reservations to prevent overspending across concurrent
 * campaign dispatches. Uses Redis to reserve wallet balance before processing.
 */
import { logger } from "../utils/logger.js";
import db from "../database/index.js";

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
      const reserveAmount = Number(amount);
      if (!Number.isFinite(reserveAmount) || reserveAmount <= 0) {
        return {
          success: false,
          reason: "Reservation amount must be greater than zero",
        };
      }

      const reservationId = `billing_reservation:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;

      // Get current wallet balance
      const wallet = await db.Wallets.findOne({
        where: { tenant_id: tenantId },
        attributes: ["balance"],
        raw: true,
      });

      if (!wallet) {
        return {
          success: false,
          reason: "Wallet not found",
        };
      }

      const dbBalance = parseFloat(wallet.balance) || 0;

      if (dbBalance < reserveAmount) {
        return {
          success: false,
          reason: `Insufficient balance. Required: ₹${reserveAmount}, Available: ₹${dbBalance}`,
        };
      }

      // Keep cache aligned with DB to prevent stale-high balances without
      // clobbering in-flight reservation deductions.
      const walletKey = `wallet:balance:${tenantId}`;
      const cachedBalanceRaw = await this.redis.get(walletKey);
      if (!cachedBalanceRaw) {
        await this.redis.set(walletKey, dbBalance.toString());
        logger.info(
          `[BILLING] Wallet cache seeded for tenant ${tenantId}: ₹${dbBalance}`,
        );
      } else {
        const cachedBalance = Number(cachedBalanceRaw);
        if (!Number.isFinite(cachedBalance)) {
          await this.redis.set(walletKey, dbBalance.toString());
          logger.warn(
            `[BILLING] Wallet cache reset for tenant ${tenantId} due to invalid cached balance`,
          );
        } else if (dbBalance < cachedBalance) {
          await this.redis.set(walletKey, dbBalance.toString());
          logger.warn(
            `[BILLING] Wallet cache corrected for tenant ${tenantId}: cache ₹${cachedBalance} -> DB ₹${dbBalance}`,
          );
        }
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

      const reservationKey = `reservation:${reservationId}`;

      const result = await this.redis.eval(
        script,
        2,
        walletKey,
        reservationKey,
        reserveAmount.toString(),
        ttl.toString(),
      );

      const [success, ...data] = result;

      if (success === 1) {
        logger.info(
          `[BILLING] Reservation created: ${reservationId} for tenant ${tenantId}, amount: ₹${reserveAmount}`,
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
   * @param {number|null} consumedAmount - Amount to consume from reservation.
   * Null consumes all reserved amount.
   * @returns {Promise<boolean>}
   */
  async confirmReservation(tenantId, reservationId, consumedAmount = null) {
    try {
      const reservationKey = `reservation:${reservationId}`;
      const walletKey = `wallet:balance:${tenantId}`;

      const hasCustomAmount =
        consumedAmount !== null &&
        consumedAmount !== undefined &&
        Number.isFinite(Number(consumedAmount));

      if (!hasCustomAmount) {
        // Default: consume full reserved amount
        const deleted = await this.redis.del(reservationKey);

        if (deleted === 1) {
          logger.info(
            `[BILLING] Reservation confirmed: ${reservationId} for tenant ${tenantId}`,
          );
          return true;
        }

        logger.warn(
          `[BILLING] Reservation not found for confirmation: ${reservationId}`,
        );
        return false;
      }

      const normalizedConsumed = Math.max(0, Number(consumedAmount));

      // Partial confirm: refund (reserved - consumed) back to wallet cache.
      const script = `
        local reservationValue = redis.call('get', KEYS[1])
        if not reservationValue then
          return {0, 'reservation_not_found'}
        end

        local reservedAmount = tonumber(reservationValue)
        local consumed = tonumber(ARGV[1])

        if consumed < 0 then
          return {0, 'invalid_consumed_amount'}
        end

        if consumed > reservedAmount then
          return {0, 'consumed_exceeds_reserved', reservedAmount}
        end

        local refund = reservedAmount - consumed
        if refund > 0 then
          redis.call('incrbyfloat', KEYS[2], refund)
        end

        redis.call('del', KEYS[1])
        return {1, refund}
      `;

      const result = await this.redis.eval(
        script,
        2,
        reservationKey,
        walletKey,
        normalizedConsumed.toString(),
      );

      const [success, info, extra] = result;

      if (success === 1) {
        const refund = Number(info) || 0;
        logger.info(
          `[BILLING] Reservation confirmed: ${reservationId} for tenant ${tenantId}, consumed: ₹${normalizedConsumed}, refunded: ₹${refund}`,
        );
        return true;
      }

      if (info === "consumed_exceeds_reserved") {
        logger.warn(
          `[BILLING] Confirm failed for ${reservationId}: consumed exceeds reserved (reserved ₹${extra})`,
        );
      } else {
        logger.warn(`[BILLING] Confirm failed for ${reservationId}: ${info}`);
      }

      return false;
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
      const wallet = await db.Wallets.findOne({
        where: { tenant_id: tenantId },
        attributes: ["balance"],
        raw: true,
      });

      if (!wallet) {
        logger.warn(`[BILLING] Wallet not found for tenant ${tenantId}`);
        return false;
      }

      const walletKey = `wallet:balance:${tenantId}`;
      await this.redis.set(walletKey, wallet.balance.toString());

      logger.debug(
        `[BILLING] Wallet balance synced for tenant ${tenantId}: ₹${wallet.balance}`,
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
