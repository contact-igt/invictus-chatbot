/**
 * Central billing configuration.
 * Change the exchange rate here and it updates across the entire project.
 */

export const DEFAULT_USD_TO_INR = 94;
export const DEFAULT_MARKUP_PERCENT = 10;

// Billing mode defaults
export const DEFAULT_BILLING_MODE = "prepaid";
export const DEFAULT_POSTPAID_CREDIT_LIMIT = 5000;

// Billing cycle
export const BILLING_CYCLE_DAYS = 30;
export const INVOICE_DUE_DAYS = 15; // Days after cycle end

// Invoice retry
export const MAX_INVOICE_RETRIES = 3;
export const RETRY_INTERVAL_HOURS = 24;

// Usage limits defaults
export const DEFAULT_LIMITS = {
  max_daily_messages: 10000,
  max_monthly_messages: 200000,
  max_daily_ai_calls: 5000,
  max_monthly_ai_calls: 100000,
};

// Wallet thresholds
export const LOW_BALANCE_THRESHOLD = 100;
export const CREDIT_LIMIT_WARNING_PERCENT = 80;

// Queue configuration (optional — requires Redis)
export const QUEUE_CONFIG = {
  concurrency: 5,
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 10000 },
  removeOnFail: { count: 5000 },
};

// Currency cache
export const CURRENCY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
export const AI_PRICING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
