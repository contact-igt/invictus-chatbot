/**
 * Campaign BullMQ queue setup.
 *
 * Queue topology:
 *   campaign-dispatch           - global queue used by scheduler/dispatch worker
 *   campaignQueue:{tenant_id}   - per-tenant send queue
 *   campaignDLQ:{tenant_id}     - per-tenant dead-letter queue
 *
 * Falls back gracefully to cron-based execution when Redis is unavailable.
 */
import net from "net";
import { logger } from "../utils/logger.js";

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";
const CONNECT_TIMEOUT_MS = Number(
  process.env.CAMPAIGN_QUEUE_CONNECT_TIMEOUT_MS || 1200,
);

let campaignDispatchQueue = null;
let redisConnection = null;
let queueAvailable = false;
let queueDisabling = false;
let queueDisableLogged = false;
let BullmqQueueCtor = null;

const tenantSendQueues = new Map();
const tenantDlqQueues = new Map();
const knownTenantIds = new Set();

const DISPATCH_QUEUE_NAME = "campaign-dispatch";

export const getCampaignDispatchQueueName = () => DISPATCH_QUEUE_NAME;

const getQueueConfig = () => {
  const jobAttempts = parseInt(process.env.CAMPAIGN_JOB_ATTEMPTS || "3", 10);
  const jobBackoffDelay = parseInt(
    process.env.CAMPAIGN_JOB_BACKOFF_DELAY || "300000",
    10,
  );
  const defaultRateMax = parseInt(
    process.env.CAMPAIGN_SEND_RATE_MAX || "3500",
    10,
  );
  const defaultRateDuration = parseInt(
    process.env.CAMPAIGN_SEND_RATE_DURATION || "60000",
    10,
  );

  return {
    jobAttempts,
    jobBackoffDelay,
    defaultRateMax,
    defaultRateDuration,
  };
};

const parseTenantRateLimitOverrides = () => {
  const raw = process.env.CAMPAIGN_TENANT_RATE_LIMITS;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch (err) {
    logger.warn(
      `[CAMPAIGN-QUEUE] Invalid CAMPAIGN_TENANT_RATE_LIMITS JSON: ${err.message}`,
    );
    return {};
  }
};

const assertReady = () => {
  if (!queueAvailable || !redisConnection) {
    throw new Error("Campaign queue is not available");
  }
};

const normalizeTenantId = (tenant_id) => {
  const normalized = String(tenant_id || "").trim();
  if (!normalized) {
    throw new Error("tenant_id is required for tenant queue operations");
  }
  return normalized;
};

export const getTenantQueueName = (tenant_id) =>
  `campaignQueue:${normalizeTenantId(tenant_id)}`;

export const getTenantDLQName = (tenant_id) =>
  `campaignDLQ:${normalizeTenantId(tenant_id)}`;

export const getTenantRateLimit = (tenant_id) => {
  const normalizedTenantId = normalizeTenantId(tenant_id);
  const { defaultRateMax } = getQueueConfig();
  const overrides = parseTenantRateLimitOverrides();
  const value = Number(overrides[normalizedTenantId]);
  return Number.isFinite(value) && value > 0 ? value : defaultRateMax;
};

// ── Redis reachability check (same approach as billingQueue.js) ──────────────

const checkRedisReachability = (url, timeoutMs = CONNECT_TIMEOUT_MS) =>
  new Promise((resolve) => {
    let opts;
    try {
      const u = new URL(url);
      opts = {
        host: u.hostname || "127.0.0.1",
        port: u.port ? Number(u.port) : 6379,
      };
    } catch {
      return resolve({ ok: false, reason: "invalid Redis URL" });
    }

    let resolved = false;
    const socket = net.createConnection(opts);
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done({ ok: true }));
    socket.once("timeout", () =>
      done({ ok: false, reason: `timeout after ${timeoutMs}ms` }),
    );
    socket.once("error", (err) => done({ ok: false, reason: err.message }));
  });

const closeTenantQueues = async () => {
  for (const queue of tenantSendQueues.values()) {
    try {
      await queue.close();
    } catch (err) {
      logger.warn(
        `[CAMPAIGN-QUEUE] Failed to close tenant send queue: ${err.message}`,
      );
    }
  }

  for (const queue of tenantDlqQueues.values()) {
    try {
      await queue.close();
    } catch (err) {
      logger.warn(
        `[CAMPAIGN-QUEUE] Failed to close tenant DLQ queue: ${err.message}`,
      );
    }
  }

  tenantSendQueues.clear();
  tenantDlqQueues.clear();
};

// ── Queue initialisation ──────────────────────────────────────────────────────

export const initCampaignQueues = async () => {
  if (redisConnection) {
    logger.info("[CAMPAIGN-QUEUE] Already initialized - skipping re-init");
    return;
  }

  const redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL;

  const reachable = await checkRedisReachability(redisUrl);
  if (!reachable.ok) {
    logger.warn(
      `[CAMPAIGN-QUEUE] Redis unreachable (${reachable.reason}) - falling back to cron-based execution`,
    );
    return;
  }

  try {
    const [bullmqModule, ioredisModule] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);

    const { Queue } = bullmqModule;
    BullmqQueueCtor = Queue;
    const IORedis = ioredisModule.default || ioredisModule;
    const { jobAttempts, jobBackoffDelay } = getQueueConfig();

    redisConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    const logQueueDisabledOnce = (message, detail) => {
      if (queueDisableLogged) return;
      queueDisableLogged = true;
      if (detail) {
        logger.warn(message, detail);
        return;
      }
      logger.warn(message);
    };

    const disableCampaignQueues = async (message, err) => {
      if (queueDisabling) return;
      queueDisabling = true;

      const dispatchQueue = campaignDispatchQueue;

      campaignDispatchQueue = null;
      queueAvailable = false;

      logQueueDisabledOnce(
        message,
        err?.message || (typeof err === "string" ? err : undefined),
      );

      try {
        if (dispatchQueue) await dispatchQueue.close();
      } catch (closeErr) {
        logger.warn(
          `[CAMPAIGN-QUEUE] Failed to close dispatch queue: ${closeErr.message}`,
        );
      }

      await closeTenantQueues();

      try {
        if (redisConnection) {
          try {
            redisConnection.disconnect();
          } catch {
            // ignore
          }
        }
      } finally {
        redisConnection = null;
        queueDisabling = false;
      }
    };

    redisConnection.on("error", (err) => {
      logger.warn(`[CAMPAIGN-QUEUE] Redis connection error: ${err.message}`);
      void disableCampaignQueues(
        "[CAMPAIGN-QUEUE] Redis connection lost - queues disabled, switching to cron fallback.",
        err,
      );
    });

    redisConnection.on("end", (err) => {
      logger.warn("[CAMPAIGN-QUEUE] Redis connection ended");
      void disableCampaignQueues(
        "[CAMPAIGN-QUEUE] Redis connection ended - queues disabled, switching to cron fallback.",
        err,
      );
    });

    redisConnection.on("close", (err) => {
      logger.warn("[CAMPAIGN-QUEUE] Redis connection closed");
      void disableCampaignQueues(
        "[CAMPAIGN-QUEUE] Redis connection closed - queues disabled, switching to cron fallback.",
        err,
      );
    });

    campaignDispatchQueue = new Queue(DISPATCH_QUEUE_NAME, {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 1000 },
      },
    });

    queueAvailable = true;
    logger.info(
      `[CAMPAIGN-QUEUE] Initialized - dispatchQueue=${DISPATCH_QUEUE_NAME} attempts=${jobAttempts} backoff=${jobBackoffDelay}ms`,
    );
  } catch (err) {
    logger.warn(
      `[CAMPAIGN-QUEUE] Initialization failed - falling back to cron: ${err.message}`,
    );
    queueAvailable = false;
  }
};

// ── Queue accessors ──────────────────────────────────────────────────────────

export const getCampaignDispatchQueue = () => campaignDispatchQueue;
export const getRedisConnection = () => redisConnection;
export const isCampaignQueueAvailable = () => queueAvailable;
export const getKnownTenantIds = () => Array.from(knownTenantIds);

export const getCampaignQueueHealth = async () => {
  if (!queueAvailable || !campaignDispatchQueue) {
    return {
      queue_available: false,
      dispatch_queue: null,
      tenant_queues: [],
      totals: {
        waiting: 0,
        active: 0,
        failed: 0,
        delayed: 0,
      },
    };
  }

  const dispatchCounts = await campaignDispatchQueue.getJobCounts(
    "waiting",
    "active",
    "failed",
    "delayed",
  );

  const tenantQueues = [];
  const totals = {
    waiting: dispatchCounts.waiting || 0,
    active: dispatchCounts.active || 0,
    failed: dispatchCounts.failed || 0,
    delayed: dispatchCounts.delayed || 0,
  };

  for (const [tenantId, queue] of tenantSendQueues.entries()) {
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "failed",
      "delayed",
    );

    totals.waiting += counts.waiting || 0;
    totals.active += counts.active || 0;
    totals.failed += counts.failed || 0;
    totals.delayed += counts.delayed || 0;

    tenantQueues.push({
      tenant_id: tenantId,
      queue_name: queue.name,
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
    });
  }

  return {
    queue_available: true,
    dispatch_queue: {
      queue_name: campaignDispatchQueue.name,
      waiting: dispatchCounts.waiting || 0,
      active: dispatchCounts.active || 0,
      failed: dispatchCounts.failed || 0,
      delayed: dispatchCounts.delayed || 0,
    },
    tenant_queues: tenantQueues,
    totals,
  };
};

export const getTenantQueue = (tenant_id) => {
  assertReady();
  const normalizedTenantId = normalizeTenantId(tenant_id);
  const existing = tenantSendQueues.get(normalizedTenantId);
  if (existing) return existing;

  const queueName = getTenantQueueName(normalizedTenantId);
  const { jobAttempts, jobBackoffDelay } = getQueueConfig();

  const { Queue } = requireBullmqQueue();
  const queue = new Queue(queueName, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: jobAttempts,
      backoff: { type: "exponential", delay: jobBackoffDelay },
      removeOnComplete: { count: 50000 },
      removeOnFail: { count: 10000 },
    },
  });

  tenantSendQueues.set(normalizedTenantId, queue);
  knownTenantIds.add(normalizedTenantId);
  logger.info(
    `[CAMPAIGN-QUEUE] Created tenant send queue ${queueName} (tenant=${normalizedTenantId})`,
  );
  return queue;
};

export const getTenantDLQ = (tenant_id) => {
  assertReady();
  const normalizedTenantId = normalizeTenantId(tenant_id);
  const existing = tenantDlqQueues.get(normalizedTenantId);
  if (existing) return existing;

  const queueName = getTenantDLQName(normalizedTenantId);
  const { Queue } = requireBullmqQueue();
  const queue = new Queue(queueName, {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    },
  });

  tenantDlqQueues.set(normalizedTenantId, queue);
  knownTenantIds.add(normalizedTenantId);
  logger.info(
    `[CAMPAIGN-QUEUE] Created tenant DLQ ${queueName} (tenant=${normalizedTenantId})`,
  );
  return queue;
};

const requireBullmqQueue = () => {
  if (!BullmqQueueCtor) {
    throw new Error(
      "BullMQ Queue constructor not initialized. Call initCampaignQueues first.",
    );
  }
  return { Queue: BullmqQueueCtor };
};

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export const closeCampaignQueues = async () => {
  try {
    if (campaignDispatchQueue) await campaignDispatchQueue.close();
    await closeTenantQueues();
    if (redisConnection) redisConnection.disconnect();
    logger.info("[CAMPAIGN-QUEUE] Closed gracefully");
  } catch (err) {
    logger.warn(`[CAMPAIGN-QUEUE] Error during close: ${err.message}`);
  }
};
