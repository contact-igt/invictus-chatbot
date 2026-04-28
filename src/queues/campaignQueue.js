/**
 * Campaign BullMQ queue setup.
 *
 * Initialises two queues backed by Redis:
 *   campaign-dispatch  — reads pending recipients and fans out send jobs
 *   campaign-send      — sends one WhatsApp message per job, rate-limited
 *
 * Falls back gracefully to cron-based execution when Redis is unavailable.
 * Mirrors the fallback pattern already used in utils/billing/billingQueue.js.
 */
import net from "net";
import { logger } from "../utils/logger.js";

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379";
const CONNECT_TIMEOUT_MS = Number(
  process.env.CAMPAIGN_QUEUE_CONNECT_TIMEOUT_MS || 1200,
);

let campaignDispatchQueue = null;
let campaignSendQueue = null;
let redisConnection = null;
let queueAvailable = false;
let queueDisabling = false;
let queueDisableLogged = false;

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

// ── Queue initialisation ──────────────────────────────────────────────────────

export const initCampaignQueues = async () => {
  // Prevent double-initialization
  if (redisConnection) {
    logger.info("[CAMPAIGN-QUEUE] Already initialized — skipping re-init");
    return;
  }

  const redisUrl = process.env.REDIS_URL || DEFAULT_REDIS_URL;

  const reachable = await checkRedisReachability(redisUrl);
  if (!reachable.ok) {
    logger.warn(
      `[CAMPAIGN-QUEUE] Redis unreachable (${reachable.reason}) — falling back to cron-based execution`,
    );
    return;
  }

  try {
    const [bullmqModule, ioredisModule] = await Promise.all([
      import("bullmq"),
      import("ioredis"),
    ]);

    const { Queue } = bullmqModule;
    const IORedis = ioredisModule.default || ioredisModule;

    redisConnection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    // Runtime handlers: disable queues if Redis connection is lost
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

      const q1 = campaignDispatchQueue;
      const q2 = campaignSendQueue;

      campaignDispatchQueue = null;
      campaignSendQueue = null;
      queueAvailable = false;

      logQueueDisabledOnce(
        message,
        err?.message || (typeof err === "string" ? err : undefined),
      );

      try {
        if (q1) await q1.close();
      } catch (closeErr) {
        logger.warn(
          `[CAMPAIGN-QUEUE] Failed to close dispatch queue: ${closeErr.message}`,
        );
      }
      try {
        if (q2) await q2.close();
      } catch (closeErr) {
        logger.warn(
          `[CAMPAIGN-QUEUE] Failed to close send queue: ${closeErr.message}`,
        );
      }

      try {
        if (redisConnection) {
          try {
            redisConnection.disconnect();
          } catch (e) {
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
      logger.warn(`[CAMPAIGN-QUEUE] Redis connection ended`);
      void disableCampaignQueues(
        "[CAMPAIGN-QUEUE] Redis connection ended - queues disabled, switching to cron fallback.",
        err,
      );
    });

    redisConnection.on("close", (err) => {
      logger.warn(`[CAMPAIGN-QUEUE] Redis connection closed`);
      void disableCampaignQueues(
        "[CAMPAIGN-QUEUE] Redis connection closed - queues disabled, switching to cron fallback.",
        err,
      );
    });

    const jobAttempts = parseInt(process.env.CAMPAIGN_JOB_ATTEMPTS || "3");
    const jobBackoffDelay = parseInt(
      process.env.CAMPAIGN_JOB_BACKOFF_DELAY || "300000",
    );
    const sendRateMax = parseInt(process.env.CAMPAIGN_SEND_RATE_MAX || "80");
    const sendRateDuration = parseInt(
      process.env.CAMPAIGN_SEND_RATE_DURATION || "60000",
    );

    campaignDispatchQueue = new Queue("campaign-dispatch", {
      connection: redisConnection,
      defaultJobOptions: {
        // Dispatch jobs are driven by the cron — no BullMQ retries needed here
        attempts: 1,
        removeOnComplete: { count: 5000 },
        removeOnFail: { count: 1000 },
      },
    });

    campaignSendQueue = new Queue("campaign-send", {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: jobAttempts,
        backoff: { type: "exponential", delay: jobBackoffDelay },
        removeOnComplete: { count: 50000 },
        removeOnFail: { count: 10000 },
      },
    });

    queueAvailable = true;
    logger.info(
      `[CAMPAIGN-QUEUE] Initialized — rateLimit=${sendRateMax}/${sendRateDuration}ms attempts=${jobAttempts} backoff=${jobBackoffDelay}ms`,
    );
  } catch (err) {
    logger.warn(
      `[CAMPAIGN-QUEUE] Initialization failed — falling back to cron: ${err.message}`,
    );
    queueAvailable = false;
  }
};

// ── Accessors ─────────────────────────────────────────────────────────────────

export const getCampaignDispatchQueue = () => campaignDispatchQueue;
export const getCampaignSendQueue = () => campaignSendQueue;
export const getRedisConnection = () => redisConnection;
export const isCampaignQueueAvailable = () => queueAvailable;

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export const closeCampaignQueues = async () => {
  try {
    if (campaignDispatchQueue) await campaignDispatchQueue.close();
    if (campaignSendQueue) await campaignSendQueue.close();
    if (redisConnection) redisConnection.disconnect();
    logger.info("[CAMPAIGN-QUEUE] Closed gracefully");
  } catch (err) {
    logger.warn(`[CAMPAIGN-QUEUE] Error during close: ${err.message}`);
  }
};
