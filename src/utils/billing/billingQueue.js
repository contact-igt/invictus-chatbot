/**
 * Asynchronous billing queue using Bull (optional — requires Redis).
 * Falls back to synchronous processing if Redis is unavailable.
 */

import net from "net";
import { logger } from "../logger.js";

let Queue;
let billingQueue = null;
let queueAvailable = false;
let queueDisableLogged = false;
let queueDisabling = false;

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";
const REDIS_CONNECT_TIMEOUT_MS = Number(
  process.env.BILLING_QUEUE_CONNECT_TIMEOUT_MS || 1200,
);

const logQueueDisabledOnce = (message, detail) => {
  if (queueDisableLogged) return;
  queueDisableLogged = true;
  if (detail) {
    logger.warn(message, detail);
    return;
  }
  logger.warn(message);
};

const isRedisConnectionError = (error) => {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "").toUpperCase();

  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "ENOTFOUND" ||
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("EHOSTUNREACH") ||
    message.includes("ENOTFOUND")
  );
};

const parseRedisEndpoint = (redisUrl) => {
  try {
    const parsedUrl = new URL(redisUrl);
    return {
      host: parsedUrl.hostname || "127.0.0.1",
      port: parsedUrl.port ? Number(parsedUrl.port) : 6379,
    };
  } catch {
    return null;
  }
};

const checkRedisReachability = async (
  redisUrl,
  timeoutMs = REDIS_CONNECT_TIMEOUT_MS,
) => {
  const endpoint = parseRedisEndpoint(redisUrl);
  if (!endpoint) {
    return { ok: false, reason: `Invalid REDIS_URL: ${redisUrl}` };
  }

  return new Promise((resolve) => {
    let resolved = false;
    const socket = net.createConnection(endpoint);

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
    socket.once("error", (error) =>
      done({ ok: false, reason: error.message || "connection error" }),
    );
  });
};

const disableQueue = async (message, error) => {
  if (queueDisabling) return;
  queueDisabling = true;

  const queueToClose = billingQueue;
  billingQueue = null;
  queueAvailable = false;

  logQueueDisabledOnce(
    message,
    error?.message || (typeof error === "string" ? error : undefined),
  );

  if (!queueToClose) {
    queueDisabling = false;
    return;
  }

  try {
    await queueToClose.close();
  } catch (closeErr) {
    logger.warn(
      `[BILLING-QUEUE] Failed to close queue after disabling: ${closeErr.message}`,
    );
  } finally {
    queueDisabling = false;
  }
};

/**
 * Initialize the billing queue.
 * Call once at app startup. Safe to call even if Redis is down.
 */
export const initBillingQueue = async () => {
  queueDisableLogged = false;
  queueDisabling = false;

  try {
    const redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL;

    const redisStatus = await checkRedisReachability(redisUrl);
    if (!redisStatus.ok) {
      await disableQueue(
        "[BILLING-QUEUE] Redis not reachable — queue disabled, using sync processing.",
        redisStatus.reason,
      );
      return;
    }

    // Dynamic import — Bull is an optional dependency
    const BullModule = await import("bull");
    Queue = BullModule.default || BullModule;

    billingQueue = new Queue("billing-processing", redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 10000 },
        removeOnFail: { count: 5000 },
      },
    });

    // Test connection
    await billingQueue.isReady();
    queueAvailable = true;

    logger.info("[BILLING-QUEUE] Initialized successfully with Redis");

    // Set up worker
    billingQueue.process(5, async (job) => {
      const { processBillingFromWebhook } =
        await import("../../models/BillingModel/billing.service.js");
      await processBillingFromWebhook(
        job.data.tenant_id,
        job.data.statusUpdate,
      );
    });

    billingQueue.on("failed", (job, err) => {
      logger.error(
        `[BILLING-QUEUE] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`,
      );
    });

    billingQueue.on("error", (error) => {
      if (queueDisabling || !queueAvailable || !billingQueue) {
        return;
      }

      if (isRedisConnectionError(error)) {
        void disableQueue(
          "[BILLING-QUEUE] Redis connection lost — queue disabled, using sync processing.",
          error,
        );
        return;
      }
      logger.error(`[BILLING-QUEUE] Queue error: ${error.message}`);
    });
  } catch (err) {
    await disableQueue(
      "[BILLING-QUEUE] Redis not available — queue disabled, using sync processing.",
      err,
    );
  }
};

/**
 * Enqueue a billing job. Falls back to sync if queue is unavailable.
 *
 * @param {string} tenant_id
 * @param {object} statusUpdate - Meta webhook status update object
 * @returns {Promise<boolean>} true if enqueued, false if processed synchronously
 */
export const enqueueBillingJob = async (tenant_id, statusUpdate) => {
  if (queueAvailable && billingQueue) {
    try {
      await billingQueue.add(
        { tenant_id, statusUpdate, received_at: new Date().toISOString() },
        { jobId: `billing_${statusUpdate.id}_${Date.now()}` },
      );
      return true;
    } catch (err) {
      logger.error(
        `[BILLING-QUEUE] Enqueue failed, falling back to sync: ${err.message}`,
      );
    }
  }

  // Sync fallback
  const { processBillingFromWebhook } =
    await import("../../models/BillingModel/billing.service.js");
  await processBillingFromWebhook(tenant_id, statusUpdate);
  return false;
};

/**
 * Check if the billing queue is operational.
 */
export const isQueueAvailable = () => queueAvailable;

/**
 * Get queue statistics.
 */
export const getQueueStats = async () => {
  if (!queueAvailable || !billingQueue) {
    return { available: false };
  }

  try {
    const [waiting, active, completed, failed] = await Promise.all([
      billingQueue.getWaitingCount(),
      billingQueue.getActiveCount(),
      billingQueue.getCompletedCount(),
      billingQueue.getFailedCount(),
    ]);

    return { available: true, waiting, active, completed, failed };
  } catch (err) {
    return { available: false, error: err.message };
  }
};

/**
 * Gracefully close the queue (for shutdown).
 */
export const closeBillingQueue = async () => {
  if (billingQueue) {
    const queueToClose = billingQueue;
    billingQueue = null;
    queueAvailable = false;
    await queueToClose.close();
    logger.info("[BILLING-QUEUE] Closed gracefully");
  }
};
