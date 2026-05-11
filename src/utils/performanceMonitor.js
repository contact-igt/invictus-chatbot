import { logger } from "./logger.js";
import {
  getCampaignDispatchQueue,
  getCampaignQueueHealth,
  getRedisConnection,
} from "../queues/campaignQueue.js";

let monitorInterval = null;

export const startCampaignPerformanceMonitor = (intervalMs = 10000) => {
  if (monitorInterval) return;
  monitorInterval = setInterval(async () => {
    try {
      const queueHealth = await getCampaignQueueHealth();
      const dispatch = queueHealth?.dispatch_queue || {};
      const totals = queueHealth?.totals || {};

      // Basic metrics
      const waiting = totals.waiting || 0;
      const active = totals.active || 0;
      const failed = totals.failed || 0;
      const delayed = totals.delayed || 0;

      logger.info(
        `[PERF] Queue depth - waiting=${waiting} active=${active} failed=${failed} delayed=${delayed}`,
      );

      if (waiting > 1000) {
        logger.warn("[PERF] Queue backlog detected", { waiting, active });
      }

      // Log dispatch queue counts
      if (dispatch && dispatch.queue_name) {
        logger.debug(
          `[PERF] Dispatch queue ${dispatch.queue_name}: waiting=${dispatch.waiting} active=${dispatch.active} failed=${dispatch.failed}`,
        );
      }

      // Redis ping
      const redis = getRedisConnection();
      if (redis) {
        try {
          const pong = await redis.ping();
          if (pong !== "PONG") {
            logger.warn(`[PERF] Redis ping unexpected: ${pong}`);
          }
        } catch (err) {
          logger.warn(`[PERF] Redis ping failed: ${err.message}`);
        }
      }
    } catch (err) {
      logger.warn(`[PERF] Performance monitor error: ${err.message}`);
    }
  }, intervalMs);
};

export const stopCampaignPerformanceMonitor = () => {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
};

export default {
  startCampaignPerformanceMonitor,
  stopCampaignPerformanceMonitor,
};
