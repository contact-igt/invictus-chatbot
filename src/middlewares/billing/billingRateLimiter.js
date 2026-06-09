/**
 * Rate limiting middleware for billing/payment endpoints.
 * Uses in-memory store (per-instance). For multi-instance, use Redis.
 */

// Simple in-memory rate limiter per tenant
const rateLimitStore = new Map();
const CLEANUP_INTERVAL = 60 * 1000; // Clean up every minute

// Periodic cleanup to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.windowStart > data.windowMs * 2) {
      rateLimitStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Create a rate limiter middleware.
 *
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs   - Window size in milliseconds
 * @returns {Function} Express middleware
 */
const createRateLimiter = (maxRequests, windowMs) => {
  return (req, res, next) => {
    const tenant_id = req.user?.tenant_id || req.ip;
    const key = `${req.path}_${tenant_id}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);

    if (!record || now - record.windowStart > windowMs) {
      record = { count: 1, windowStart: now, windowMs };
      rateLimitStore.set(key, record);
      return next();
    }

    record.count++;

    if (record.count > maxRequests) {
      const retryAfter = Math.ceil(
        (record.windowStart + windowMs - now) / 1000,
      );
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        retryAfter,
      });
    }

    next();
  };
};

// Pre-configured rate limiters

/** Payment endpoints: 5 requests per minute per tenant */
export const paymentRateLimiter = createRateLimiter(5, 60 * 1000);

/** Invoice payment: 3 requests per minute per tenant */
export const invoicePaymentRateLimiter = createRateLimiter(3, 60 * 1000);

/** Billing query endpoints: 30 requests per minute per tenant */
export const billingQueryRateLimiter = createRateLimiter(30, 60 * 1000);

/**
 * Admin billing mutation endpoints (force-unlock, manual-credit, change-mode, invoice-close).
 * Stricter limit: 10 mutations per minute per admin IP/ID to prevent abuse
 * if an admin account is compromised.
 */
export const adminBillingRateLimiter = createRateLimiter(10, 60 * 1000);
