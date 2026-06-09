import db from "../../database/index.js";
import { Op } from "sequelize";
import { getIO } from "../../middlewares/socket/socket.js";

// In-memory cache for usage counts (1-min TTL per tenant)
const usageCountCache = new Map();
const USAGE_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Check whether a tenant has exceeded daily or monthly usage limits.
 *
 * @param {string} tenant_id
 * @param {"message"|"ai_call"} usage_type
 * @returns {Promise<{ allowed: boolean, reason?: string, daily: { used: number, limit: number, percent: number }, monthly: { used: number, limit: number, percent: number } }>}
 */
export const checkUsageLimit = async (tenant_id, usage_type) => {
  // 1. Fetch tenant limits
  const tenant = await db.Tenants.findOne({
    where: { tenant_id },
    attributes: [
      "max_daily_messages",
      "max_monthly_messages",
      "max_daily_ai_calls",
      "max_monthly_ai_calls",
      "billing_cycle_start",
    ],
    raw: true,
  });

  if (!tenant) {
    return {
      allowed: true,
      daily: { used: 0, limit: 0, percent: 0 },
      monthly: { used: 0, limit: 0, percent: 0 },
    };
  }

  const dailyLimit =
    usage_type === "message"
      ? tenant.max_daily_messages || 10000
      : tenant.max_daily_ai_calls || 5000;
  const monthlyLimit =
    usage_type === "message"
      ? tenant.max_monthly_messages || 200000
      : tenant.max_monthly_ai_calls || 100000;

  // 2. Get usage counts (with cache)
  const cacheKey = `${tenant_id}_${usage_type}`;
  const now = Date.now();
  let counts;

  if (usageCountCache.has(cacheKey)) {
    const cached = usageCountCache.get(cacheKey);
    if (now - cached.ts < USAGE_CACHE_TTL) {
      counts = cached.counts;
    }
  }

  if (!counts) {
    counts = await fetchUsageCounts(
      tenant_id,
      usage_type,
      tenant.billing_cycle_start,
    );
    usageCountCache.set(cacheKey, { counts, ts: now });
  }

  const dailyPercent = dailyLimit > 0 ? (counts.daily / dailyLimit) * 100 : 0;
  const monthlyPercent =
    monthlyLimit > 0 ? (counts.monthly / monthlyLimit) * 100 : 0;

  const result = {
    allowed: true,
    daily: {
      used: counts.daily,
      limit: dailyLimit,
      percent: Math.round(dailyPercent),
    },
    monthly: {
      used: counts.monthly,
      limit: monthlyLimit,
      percent: Math.round(monthlyPercent),
    },
  };

  // 3. Check limits — block at 100%
  if (counts.daily >= dailyLimit) {
    result.allowed = false;
    result.reason = `Daily ${usage_type} limit reached (${dailyLimit}). Please try again tomorrow.`;
    return result;
  }
  if (counts.monthly >= monthlyLimit) {
    result.allowed = false;
    result.reason = `Monthly ${usage_type} limit reached (${monthlyLimit}). Contact support to increase your limit.`;
    return result;
  }

  // 4. Emit warnings at 80%
  if (dailyPercent >= 80 || monthlyPercent >= 80) {
    try {
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("usage-limit-warning", {
        tenant_id,
        usage_type,
        daily: result.daily,
        monthly: result.monthly,
      });
    } catch (_) {}
  }

  return result;
};

/**
 * Fetch actual usage counts from the database.
 */
const fetchUsageCounts = async (tenant_id, usage_type, billingCycleStart) => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const cycleStart = billingCycleStart ? new Date(billingCycleStart) : today;

  if (usage_type === "message") {
    const [dailyCount, monthlyCount] = await Promise.all([
      db.MessageUsage.count({
        where: {
          tenant_id,
          createdAt: { [Op.gte]: today },
        },
      }),
      db.MessageUsage.count({
        where: {
          tenant_id,
          createdAt: { [Op.gte]: cycleStart },
        },
      }),
    ]);
    return { daily: dailyCount, monthly: monthlyCount };
  }

  // ai_call
  const [dailyCount, monthlyCount] = await Promise.all([
    db.AiTokenUsage.count({
      where: {
        tenant_id,
        createdAt: { [Op.gte]: today },
      },
    }),
    db.AiTokenUsage.count({
      where: {
        tenant_id,
        createdAt: { [Op.gte]: cycleStart },
      },
    }),
  ]);
  return { daily: dailyCount, monthly: monthlyCount };
};

/**
 * Invalidate usage cache for a tenant (called after new billing event).
 */
export const invalidateUsageCache = (tenant_id) => {
  usageCountCache.delete(`${tenant_id}_message`);
  usageCountCache.delete(`${tenant_id}_ai_call`);
};
