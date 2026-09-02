/**
 * Campaign BullMQ queue setup.
 *
 * Queue topology:
 *   campaign-dispatch           - global queue used by scheduler/dispatch worker
 *   campaignQueue-{tenant_id}   - per-tenant send queue
 *   campaignDLQ-{tenant_id}     - per-tenant dead-letter queue
 *
 * Falls back gracefully to cron-based execution when Redis is unavailable.
 *
 * CAMPAIGN_* env knobs used by campaign queues/workers:
 *   BULLMQ_QUEUE_PREFIX               per-env Redis keyspace ("stage"/"prod"); unset = "bull"
 *   CAMPAIGN_QUEUE_CONNECT_TIMEOUT_MS  Redis probe timeout, default 1200 ms
 *   CAMPAIGN_JOB_ATTEMPTS              send job attempts, default 3
 *   CAMPAIGN_JOB_BACKOFF_DELAY         send retry delay, default 300000 ms
 *   CAMPAIGN_SEND_RATE_MAX             tenant queue rate max, default 3500
 *   CAMPAIGN_SEND_RATE_DURATION        tenant queue rate window, default 60000 ms
 *   CAMPAIGN_TENANT_RATE_LIMITS        JSON map of tenant_id to rate max
 *   CAMPAIGN_DISPATCH_PAGE_SIZE        dispatch page size, default 500
 *   CAMPAIGN_DISPATCH_LOCK_TTL         dispatch lock TTL, default 120 s
 *   CAMPAIGN_BILLING_RESERVATION_TTL   reservation TTL, default 1800 s
 *   CAMPAIGN_DISPATCH_CONCURRENCY      dispatch worker concurrency, default 10
 *   CAMPAIGN_DISPATCH_CHUNK_SIZE       addBulk chunk size, default 500
 *   CAMPAIGN_SEND_CONCURRENCY          send worker concurrency, default 20
 *   CAMPAIGN_META_RATE_PER_SEC         Meta API limiter, default 80
 *   CAMPAIGN_DB_BATCH_SIZE             DB flush batch size, default 100
 *   CAMPAIGN_DB_BATCH_FLUSH_MS         DB flush interval, default 500 ms
 *   CAMPAIGN_STALE_RECOVERY_MS         stuck active recovery age, default 120000 ms
 *   CAMPAIGN_MAX_ACTIVE_HOURS          stale active auto-fail age, default 48 h
 *   CAMPAIGN_EVENT_WEBHOOK_SECRET      optional event webhook shared secret
 */
import net from "net";
import { logger } from "../utils/logger.js";
import { resetRedisCaches } from "../utils/redis/redisCache.js";
import { resetRedisLock } from "../utils/redis/redisLock.js";
import { resetCampaignBillingService } from "../services/campaignBillingService.js";

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
let intentionalClose = false;
let connectionIssueLogged = false;
let reinitTimer = null;

const REACHABILITY_RETRY_ATTEMPTS = Number(
  process.env.CAMPAIGN_QUEUE_REACHABILITY_ATTEMPTS || 5,
);
const REACHABILITY_RETRY_GAP_MS = Number(
  process.env.CAMPAIGN_QUEUE_REACHABILITY_GAP_MS || 3000,
);
const REINIT_INTERVAL_MS = Number(
  process.env.CAMPAIGN_QUEUE_REINIT_INTERVAL_MS || 15000,
);

// Per-environment BullMQ keyspace isolation. Stage, Production and wellinit-backend
// all connect to the same Redis; without a distinct prefix they share the exact
// same queue keys and job ids, so one environment's dispatch/send worker silently
// consumes another environment's jobs (loads the campaign from the wrong DB, finds
// nothing, ends the job — the campaign stalls). Set BULLMQ_QUEUE_PREFIX per
// deployment (e.g. "stage", "prod"). Unset → "bull" (BullMQ default, unchanged).
const BULL_PREFIX = (() => {
  const env = String(process.env.BULLMQ_QUEUE_PREFIX || "").trim();
  return env ? `bull-${env}` : "bull";
})();

export const getBullPrefix = () => BULL_PREFIX;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logConnectionIssueOnce = (message) => {
  if (connectionIssueLogged) return;
  connectionIssueLogged = true;
  logger.warn(message);
};

// Background retry loop used only when there is NO live Redis connection object
// (startup could not reach Redis, or the connection permanently ended). A
// transient drop is handled by ioredis auto-reconnect + the "ready" handler and
// never reaches here.
const scheduleQueueReinit = () => {
  if (reinitTimer) return;
  reinitTimer = setInterval(() => {
    if (queueAvailable && redisConnection && campaignDispatchQueue) {
      clearInterval(reinitTimer);
      reinitTimer = null;
      return;
    }
    void initCampaignQueues().catch(() => {});
  }, REINIT_INTERVAL_MS);
  if (typeof reinitTimer.unref === "function") reinitTimer.unref();
};

// Called by the app-level supervisor to make sure the queue is alive. Safe to
// call repeatedly: it is a no-op when the connection is healthy or mid-reconnect.
export const ensureCampaignQueues = async () => {
  if (queueAvailable && redisConnection && campaignDispatchQueue) return true;
  if (queueDisabling) return false;
  await initCampaignQueues();
  return queueAvailable;
};

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
  `campaignQueue-${normalizeTenantId(tenant_id)}`;

export const getTenantDLQName = (tenant_id) =>
  `campaignDLQ-${normalizeTenantId(tenant_id)}`;

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

const resetRedisDependents = () => {
  resetRedisCaches();
  resetRedisLock();
  resetCampaignBillingService();
};

const buildRedisConnection = (IORedis, redisUrl) =>
  new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });

const waitForRedisReady = async (redis) => {
  if (!redis) return false;
  if (redis.status === "wait") {
    await redis.connect();
  }
  const pingResult = await redis.ping();
  return pingResult === "PONG";
};

// ── Queue initialisation ──────────────────────────────────────────────────────

export const initCampaignQueues = async () => {
  // A live connection object already exists (healthy, or mid auto-reconnect).
  // Never rebuild on top of it — that would leak a second connection/queue.
  if (redisConnection && campaignDispatchQueue && !queueDisabling) {
    if (redisConnection.status === "ready" && !queueAvailable) {
      queueAvailable = true;
      connectionIssueLogged = false;
      logger.warn(
        "[CAMPAIGN-QUEUE] Connection already healthy - queue marked available",
      );
    }
    return;
  }

  if (queueDisabling) {
    logger.warn(
      "[CAMPAIGN-QUEUE] Initialization skipped while queue is disabling",
    );
    return;
  }

  queueDisableLogged = false;
  intentionalClose = false;

  const redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL;

  let reachable = await checkRedisReachability(redisUrl);
  for (
    let attempt = 1;
    attempt < REACHABILITY_RETRY_ATTEMPTS && !reachable.ok;
    attempt += 1
  ) {
    await sleep(REACHABILITY_RETRY_GAP_MS);
    reachable = await checkRedisReachability(redisUrl);
  }
  if (!reachable.ok) {
    logger.warn(
      `[CAMPAIGN-QUEUE] Redis unreachable after ${REACHABILITY_RETRY_ATTEMPTS} attempt(s) (${reachable.reason}) - retrying in background, cron handles execution meanwhile`,
    );
    scheduleQueueReinit();
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

    redisConnection = buildRedisConnection(IORedis, redisUrl);
    const redisReady = await waitForRedisReady(redisConnection);
    if (!redisReady) {
      throw new Error("Redis ping failed");
    }

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
      resetRedisDependents();

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
            intentionalClose = true;
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

    // Transient drops (error/close) are NOT fatal: ioredis auto-reconnects
    // (retryStrategy runs forever, maxRetriesPerRequest=null). We only pause the
    // queue flag; BullMQ queues/workers share this connection and resume on
    // "ready". Tearing the connection down here (the old behaviour) killed the
    // auto-reconnect and left campaigns stuck PENDING until a process restart.
    redisConnection.on("error", (err) => {
      if (intentionalClose || queueDisabling) return;
      logConnectionIssueOnce(
        `[CAMPAIGN-QUEUE] Redis connection error: ${err.message} - awaiting auto-reconnect`,
      );
      // If the socket isn't ready, mark unavailable so enqueue callers fall back
      // to the cron path instead of blocking on a command that can't flush.
      if (redisConnection && redisConnection.status !== "ready" && queueAvailable) {
        queueAvailable = false;
      }
    });

    redisConnection.on("close", () => {
      if (intentionalClose || queueDisabling) return;
      if (queueAvailable) {
        queueAvailable = false;
        logger.warn(
          "[CAMPAIGN-QUEUE] Redis connection closed - queue paused, awaiting reconnect",
        );
      }
    });

    redisConnection.on("reconnecting", () => {
      if (intentionalClose || queueDisabling) return;
    });

    redisConnection.on("ready", () => {
      if (intentionalClose || queueDisabling) return;
      connectionIssueLogged = false;
      if (!queueAvailable && campaignDispatchQueue) {
        queueAvailable = true;
        logger.warn("[CAMPAIGN-QUEUE] Redis reconnected - queue resumed");
      }
    });

    // "end" fires only when ioredis has permanently given up (e.g. after an
    // explicit disconnect). Then we do a full teardown and background re-init.
    redisConnection.on("end", () => {
      if (intentionalClose || queueDisabling) return;
      logger.warn(
        "[CAMPAIGN-QUEUE] Redis connection ended - tearing down and scheduling re-init",
      );
      void disableCampaignQueues(
        "[CAMPAIGN-QUEUE] Redis connection ended - queues disabled pending re-init.",
      ).finally(scheduleQueueReinit);
    });

    campaignDispatchQueue = new Queue(DISPATCH_QUEUE_NAME, {
      connection: redisConnection,
      prefix: BULL_PREFIX,
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
  const seenTenantIds = new Set();
  const totals = {
    waiting: dispatchCounts.waiting || 0,
    active: dispatchCounts.active || 0,
    failed: dispatchCounts.failed || 0,
    delayed: dispatchCounts.delayed || 0,
  };

  for (const [tenantId, queue] of tenantSendQueues.entries()) {
    seenTenantIds.add(tenantId);
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

  if (BullmqQueueCtor && redisConnection) {
    let stream = null;
    do {
      const [nextCursor, keys] = await redisConnection.scan(
        stream || "0",
        "MATCH",
        `${BULL_PREFIX}:campaignQueue-*:*`,
        "COUNT",
        250,
      );
      stream = nextCursor;

      const tenantKeyRe = new RegExp(`^${BULL_PREFIX}:campaignQueue-([^:]+):`);
      for (const key of keys) {
        const match = key.match(tenantKeyRe);
        const tenantId = match?.[1];
        if (!tenantId || seenTenantIds.has(tenantId)) continue;

        const queue = new BullmqQueueCtor(getTenantQueueName(tenantId), {
          connection: redisConnection,
          prefix: BULL_PREFIX,
        });
        try {
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
            discovered: true,
          });
          seenTenantIds.add(tenantId);
        } finally {
          await queue.close();
        }
      }
    } while (stream !== "0");
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
    prefix: BULL_PREFIX,
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
    prefix: BULL_PREFIX,
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
    intentionalClose = true;
    const dispatchQueue = campaignDispatchQueue;
    campaignDispatchQueue = null;
    queueAvailable = false;
    if (dispatchQueue) await dispatchQueue.close();
    await closeTenantQueues();
    if (redisConnection) redisConnection.disconnect();
    redisConnection = null;
    resetRedisDependents();
    logger.info("[CAMPAIGN-QUEUE] Closed gracefully");
  } catch (err) {
    logger.warn(`[CAMPAIGN-QUEUE] Error during close: ${err.message}`);
  }
};
