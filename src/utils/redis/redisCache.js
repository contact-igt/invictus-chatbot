/**
 * Redis-based Shared Caching Utility
 *
 * Provides centralized caching for templates, components, and other frequently
 * accessed data to reduce database load and improve performance.
 */
import { logger } from "../logger.js";

export class RedisCache {
  constructor(redisClient, options = {}) {
    this.redis = redisClient;
    this.keyPrefix = options.keyPrefix || "cache:";
    this.defaultTTL = options.defaultTTL || 3600; // 1 hour
    this.compress = options.compress || false;
  }

  /**
   * Generate cache key with prefix
   * @param {string} key - Base key
   * @returns {string} Prefixed key
   */
  _getKey(key) {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Set cache value with TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>}
   */
  async set(key, value, ttl = this.defaultTTL) {
    try {
      const cacheKey = this._getKey(key);
      const serializedValue = JSON.stringify(value);

      if (this.compress && serializedValue.length > 1024) {
        // Could implement compression here if needed
        await this.redis.setex(cacheKey, ttl, serializedValue);
      } else {
        await this.redis.setex(cacheKey, ttl, serializedValue);
      }

      return true;
    } catch (err) {
      logger.warn(
        `[REDIS-CACHE] Failed to set cache key ${key}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Get cache value
   * @param {string} key - Cache key
   * @returns {Promise<any|null>}
   */
  async get(key) {
    try {
      const cacheKey = this._getKey(key);
      const value = await this.redis.get(cacheKey);

      if (!value) {
        return null;
      }

      return JSON.parse(value);
    } catch (err) {
      logger.warn(
        `[REDIS-CACHE] Failed to get cache key ${key}: ${err.message}`,
      );
      return null;
    }
  }

  /**
   * Delete cache key
   * @param {string} key - Cache key
   * @returns {Promise<boolean>}
   */
  async del(key) {
    try {
      const cacheKey = this._getKey(key);
      await this.redis.del(cacheKey);
      return true;
    } catch (err) {
      logger.warn(
        `[REDIS-CACHE] Failed to delete cache key ${key}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    try {
      const cacheKey = this._getKey(key);
      const result = await this.redis.exists(cacheKey);
      return result === 1;
    } catch (err) {
      logger.warn(
        `[REDIS-CACHE] Failed to check cache key ${key}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Set multiple cache values
   * @param {Object} keyValuePairs - Object with keys and values
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise<boolean>}
   */
  async mset(keyValuePairs, ttl = this.defaultTTL) {
    try {
      const pipeline = this.redis.pipeline();

      Object.entries(keyValuePairs).forEach(([key, value]) => {
        const cacheKey = this._getKey(key);
        const serializedValue = JSON.stringify(value);
        pipeline.setex(cacheKey, ttl, serializedValue);
      });

      await pipeline.exec();
      return true;
    } catch (err) {
      logger.warn(
        `[REDIS-CACHE] Failed to set multiple cache keys: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Get multiple cache values
   * @param {string[]} keys - Array of cache keys
   * @returns {Promise<Object>}
   */
  async mget(keys) {
    try {
      const cacheKeys = keys.map((key) => this._getKey(key));
      const values = await this.redis.mget(cacheKeys);

      const result = {};
      keys.forEach((key, index) => {
        const value = values[index];
        result[key] = value ? JSON.parse(value) : null;
      });

      return result;
    } catch (err) {
      logger.warn(
        `[REDIS-CACHE] Failed to get multiple cache keys: ${err.message}`,
      );
      return {};
    }
  }

  /**
   * Clear all cache keys with current prefix
   * @returns {Promise<boolean>}
   */
  async clear() {
    try {
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(keys);
      }

      return true;
    } catch (err) {
      logger.warn(`[REDIS-CACHE] Failed to clear cache: ${err.message}`);
      return false;
    }
  }

  /**
   * Get cache statistics
   * @returns {Promise<Object>}
   */
  async getStats() {
    try {
      const pattern = `${this.keyPrefix}*`;
      const keys = await this.redis.keys(pattern);

      return {
        keyCount: keys.length,
        keyPrefix: this.keyPrefix,
        keys: keys.slice(0, 10), // Sample first 10 keys
      };
    } catch (err) {
      logger.warn(`[REDIS-CACHE] Failed to get cache stats: ${err.message}`);
      return { keyCount: 0, error: err.message };
    }
  }
}

// Campaign-specific cache methods
export class CampaignCache extends RedisCache {
  constructor(redisClient) {
    super(redisClient, {
      keyPrefix: "campaign:cache:",
      defaultTTL: 3600, // 1 hour
    });
  }

  /**
   * Cache template components
   * @param {string} templateId - Template ID
   * @param {Object} components - Template components data
   * @returns {Promise<boolean>}
   */
  async setTemplateComponents(templateId, components) {
    return this.set(`template:${templateId}:components`, components, 3600);
  }

  /**
   * Get cached template components
   * @param {string} templateId - Template ID
   * @returns {Promise<Object|null>}
   */
  async getTemplateComponents(templateId) {
    return this.get(`template:${templateId}:components`);
  }

  /**
   * Cache template carousel data
   * @param {string} templateId - Template ID
   * @param {Array} carouselData - Carousel components data
   * @returns {Promise<boolean>}
   */
  async setTemplateCarousel(templateId, carouselData) {
    return this.set(`template:${templateId}:carousel`, carouselData, 3600);
  }

  /**
   * Get cached template carousel data
   * @param {string} templateId - Template ID
   * @returns {Promise<Array|null>}
   */
  async getTemplateCarousel(templateId) {
    return this.get(`template:${templateId}:carousel`);
  }

  /**
   * Cache campaign metadata
   * @param {string} campaignId - Campaign ID
   * @param {Object} metadata - Campaign metadata
   * @returns {Promise<boolean>}
   */
  async setCampaignMetadata(campaignId, metadata) {
    return this.set(`campaign:${campaignId}:metadata`, metadata, 1800); // 30 min
  }

  /**
   * Get cached campaign metadata
   * @param {string} campaignId - Campaign ID
   * @returns {Promise<Object|null>}
   */
  async getCampaignMetadata(campaignId) {
    return this.get(`campaign:${campaignId}:metadata`);
  }

  /**
   * Invalidate template cache when template is updated
   * @param {string} templateId - Template ID
   * @returns {Promise<boolean>}
   */
  async invalidateTemplate(templateId) {
    const keys = [
      `template:${templateId}:components`,
      `template:${templateId}:carousel`,
    ];

    try {
      await Promise.all(keys.map((key) => this.del(key)));
      return true;
    } catch (err) {
      logger.warn(
        `[CAMPAIGN-CACHE] Failed to invalidate template ${templateId}: ${err.message}`,
      );
      return false;
    }
  }
}

// Export singleton instances
let redisCacheInstance = null;
let campaignCacheInstance = null;

export const getRedisCache = (redisClient) => {
  if (!redisCacheInstance && redisClient) {
    redisCacheInstance = new RedisCache(redisClient);
  }
  return redisCacheInstance;
};

export const getCampaignCache = (redisClient) => {
  if (!campaignCacheInstance && redisClient) {
    campaignCacheInstance = new CampaignCache(redisClient);
  }
  return campaignCacheInstance;
};
