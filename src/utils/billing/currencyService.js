import db from "../../database/index.js";
import { DEFAULT_USD_TO_INR } from "../../config/billing.config.js";
import { logger } from "../logger.js";
import { recordBillingHealthEvent } from "../healthEventService.js";

// In-memory cache for currency rates
let rateCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const currencyHealthThrottle = new Map();

const reportCurrencyHealthEvent = async (key, message, metadata = {}) => {
  const now = Date.now();
  const lastReportedAt = currencyHealthThrottle.get(key) || 0;

  if (now - lastReportedAt < CACHE_TTL) {
    return;
  }

  currencyHealthThrottle.set(key, now);
  await recordBillingHealthEvent({
    event_type: "currency_fallback",
    tenant_id: null,
    error_message: message,
    metadata,
  });
};

/**
 * Get conversion rate between two currencies.
 * Priority: cache → DB → last known → config default.
 *
 * @param {string} from - Source currency code (e.g. "USD")
 * @param {string} to   - Target currency code (e.g. "INR")
 * @returns {Promise<{ rate: number, source: string, updatedAt: Date|null }>}
 */
export const getConversionRate = async (from = "USD", to = "INR") => {
  const cacheKey = `${from}_${to}`;

  // 1. Check in-memory cache
  const now = Date.now();
  const cachedEntry = rateCache.get(cacheKey);
  if (cachedEntry && now - cachedEntry.ts < CACHE_TTL) {
    const cached = rateCache.get(cacheKey);
    return {
      rate: cached.rate,
      source: cached.source,
      updatedAt: cached.updatedAt,
    };
  }

  // 2. Query DB
  try {
    const record = await db.CurrencyRates.findOne({
      where: { currency_from: from, currency_to: to },
      raw: true,
    });

    if (record) {
      const rate = parseFloat(record.conversion_rate);
      const entry = {
        rate,
        source: record.source,
        updatedAt: record.updatedAt,
        ts: now,
      };
      rateCache.set(cacheKey, entry);
      return entry;
    }
  } catch (err) {
    logger.error(
      `[CURRENCY] DB lookup failed for ${from}→${to}: ${err.message}`,
    );
    await reportCurrencyHealthEvent(
      `db_failure:${cacheKey}`,
      `Currency DB lookup failed for ${from}→${to}: ${err.message}`,
      {
        pair: cacheKey,
      },
    );
  }

  // 3. Return last known cached value if DB failed
  if (rateCache.has(cacheKey)) {
    const cached = rateCache.get(cacheKey);
    logger.warn(
      `[CURRENCY] Using stale cache for ${from}→${to}: ${cached.rate}`,
    );
    await reportCurrencyHealthEvent(
      `stale_cache:${cacheKey}`,
      `Using stale currency cache for ${from}→${to}`,
      {
        pair: cacheKey,
        rate: cached.rate,
        updatedAt: cached.updatedAt,
      },
    );
    return {
      rate: cached.rate,
      source: "stale_cache",
      updatedAt: cached.updatedAt,
    };
  }

  // 4. Ultimate fallback to config default
  if (from === "USD" && to === "INR") {
    logger.warn(
      `[CURRENCY] No rate found for USD→INR, using default: ${DEFAULT_USD_TO_INR}`,
    );
    await reportCurrencyHealthEvent(
      `default:${cacheKey}`,
      `No DB-backed currency rate found for USD→INR. Using default ${DEFAULT_USD_TO_INR}.`,
      {
        pair: cacheKey,
        fallbackRate: DEFAULT_USD_TO_INR,
      },
    );
    return { rate: DEFAULT_USD_TO_INR, source: "default", updatedAt: null };
  }

  // Unknown pair — return 1:1 with warning
  logger.error(`[CURRENCY] No conversion rate for ${from}→${to}. Returning 1.`);
  await reportCurrencyHealthEvent(
    `unsupported:${cacheKey}`,
    `Unsupported currency pair ${from}→${to} requested. Falling back to 1:1 conversion.`,
    {
      pair: cacheKey,
    },
  );
  return { rate: 1, source: "fallback", updatedAt: null };
};

/**
 * Create or update a conversion rate.
 *
 * @param {string} from   - Source currency code
 * @param {string} to     - Target currency code
 * @param {number} rate   - Conversion rate
 * @param {string} source - "manual" | "api"
 * @returns {Promise<object>} The upserted record
 */
export const updateConversionRate = async (
  from,
  to,
  rate,
  source = "manual",
) => {
  const [record, created] = await db.CurrencyRates.findOrCreate({
    where: { currency_from: from, currency_to: to },
    defaults: {
      currency_from: from,
      currency_to: to,
      conversion_rate: rate,
      source,
    },
  });

  if (!created) {
    await record.update({ conversion_rate: rate, source });
  }

  // Invalidate cache
  const cacheKey = `${from}_${to}`;
  rateCache.delete(cacheKey);

  logger.info(`[CURRENCY] Updated ${from}→${to}: ${rate} (source: ${source})`);
  return record;
};

/**
 * Invalidate the entire rate cache (e.g. after bulk update).
 */
export const invalidateRateCache = () => {
  rateCache = new Map();
};
