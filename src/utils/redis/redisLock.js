/**
 * Redis-based Distributed Locking Utility
 *
 * Provides reliable distributed locking with automatic renewal and proper cleanup.
 * Uses Redis atomic operations to prevent race conditions.
 */
import { logger } from "../logger.js";

export class RedisLock {
  constructor(redisClient, options = {}) {
    this.redis = redisClient;
    this.defaultTTL = options.defaultTTL || 30; // seconds
    this.retryDelay = options.retryDelay || 100; // ms
    this.maxRetries = options.maxRetries || 3;
  }

  /**
   * Acquire a distributed lock with automatic renewal
   * @param {string} key - Lock key
   * @param {number} ttl - Time to live in seconds
   * @param {number} renewIntervalMs - Renewal interval in milliseconds
   * @returns {Promise<{success: boolean, token?: string, release?: Function}>}
   */
  async acquire(key, ttl = this.defaultTTL, renewIntervalMs = 10000) {
    const lockKey = `lock:${key}`;
    const token = `token:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Try to acquire lock atomically
      const acquired = await this.redis.set(lockKey, token, "EX", ttl, "NX");

      if (acquired !== "OK") {
        return { success: false };
      }

      // Start renewal timer
      let renewalTimer = null;
      let isReleased = false;

      const renewLock = async () => {
        if (isReleased) return;

        try {
          // Check if we still own the lock and extend it
          const currentToken = await this.redis.get(lockKey);
          if (currentToken === token) {
            await this.redis.expire(lockKey, ttl);
          } else {
            // Lock stolen or expired, stop renewal
            clearInterval(renewalTimer);
            renewalTimer = null;
          }
        } catch (err) {
          logger.warn(
            `[REDIS-LOCK] Failed to renew lock ${lockKey}: ${err.message}`,
          );
        }
      };

      // Start renewal
      renewalTimer = setInterval(renewLock, renewIntervalMs);

      // Return release function
      const release = async () => {
        if (isReleased) return;
        isReleased = true;

        if (renewalTimer) {
          clearInterval(renewalTimer);
          renewalTimer = null;
        }

        // Atomic release: only delete if we still own the lock
        try {
          const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
              return redis.call("del", KEYS[1])
            else
              return 0
            end
          `;
          await this.redis.eval(script, 1, lockKey, token);
        } catch (err) {
          logger.warn(
            `[REDIS-LOCK] Failed to release lock ${lockKey}: ${err.message}`,
          );
        }
      };

      return {
        success: true,
        token,
        release,
      };
    } catch (err) {
      logger.error(
        `[REDIS-LOCK] Failed to acquire lock ${lockKey}: ${err.message}`,
      );
      return { success: false };
    }
  }

  /**
   * Try to acquire lock with retries
   * @param {string} key - Lock key
   * @param {number} ttl - Time to live in seconds
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<{success: boolean, token?: string, release?: Function}>}
   */
  async acquireWithRetry(
    key,
    ttl = this.defaultTTL,
    maxRetries = this.maxRetries,
  ) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.acquire(key, ttl);

      if (result.success) {
        return result;
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      }
    }

    return { success: false };
  }

  /**
   * Check if lock is currently held
   * @param {string} key - Lock key
   * @returns {Promise<boolean>}
   */
  async isLocked(key) {
    const lockKey = `lock:${key}`;
    try {
      const exists = await this.redis.exists(lockKey);
      return exists === 1;
    } catch (err) {
      logger.warn(
        `[REDIS-LOCK] Failed to check lock ${lockKey}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Force release a lock (use with caution)
   * @param {string} key - Lock key
   * @returns {Promise<boolean>}
   */
  async forceRelease(key) {
    const lockKey = `lock:${key}`;
    try {
      await this.redis.del(lockKey);
      return true;
    } catch (err) {
      logger.warn(
        `[REDIS-LOCK] Failed to force release lock ${lockKey}: ${err.message}`,
      );
      return false;
    }
  }
}

// Export singleton instance
let redisLockInstance = null;

export const getRedisLock = (redisClient) => {
  if (!redisLockInstance && redisClient) {
    redisLockInstance = new RedisLock(redisClient, {
      defaultTTL: 120, // 2 minutes for campaign dispatch
      retryDelay: 200,
      maxRetries: 2,
    });
  }
  return redisLockInstance;
};
