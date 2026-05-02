import db from "../database/index.js";
import {
  getCampaignQueueHealth,
  getRedisConnection,
  isCampaignQueueAvailable,
} from "../queues/campaignQueue.js";
import { getDispatchWorkerStatus } from "../workers/campaignDispatchWorker.js";
import { getSendWorkerStatus } from "../workers/campaignSendWorker.js";

export const getCampaignDiagnosticsService = async () => {
  const now = new Date();

  const dueCampaigns = await db.WhatsappCampaigns.findAll({
    where: {
      status: "scheduled",
      scheduled_at: { [db.Sequelize.Op.lte]: now },
      is_deleted: false,
    },
    attributes: ["campaign_id", "scheduled_at"],
    order: [["scheduled_at", "ASC"]],
  });

  const dueCampaignsWithCounts = await Promise.all(
    dueCampaigns.map(async (campaign) => {
      const recipientCount = await db.WhatsappCampaignRecipients.count({
        where: {
          campaign_id: campaign.campaign_id,
          is_deleted: false,
          status: "pending",
        },
      });

      return {
        campaign_id: campaign.campaign_id,
        scheduled_at: campaign.scheduled_at,
        recipient_count: recipientCount,
      };
    }),
  );

  const queueHealth = await getCampaignQueueHealth();

  const queueTotals = queueHealth?.totals || {
    waiting: 0,
    active: 0,
    failed: 0,
    delayed: 0,
  };

  const queueStats = {
    queue_available: isCampaignQueueAvailable(),
    waiting: queueTotals.waiting || 0,
    active: queueTotals.active || 0,
    failed: queueTotals.failed || 0,
    delayed: queueTotals.delayed || 0,
    dispatch_queue: queueHealth?.dispatch_queue || null,
    tenant_queues: queueHealth?.tenant_queues || [],
  };

  const dispatchStatus = getDispatchWorkerStatus();
  const sendStatus = getSendWorkerStatus();

  const workerStatus = {
    running: Boolean(dispatchStatus?.running) || Boolean(sendStatus?.running),
    active_worker_count:
      Number(dispatchStatus?.active_worker_count || 0) +
      Number(sendStatus?.active_worker_count || 0),
    dispatch_worker: dispatchStatus,
    send_worker: sendStatus,
  };

  const redis = getRedisConnection();
  let redisStatus = redis?.status || "disconnected";
  if (redis) {
    try {
      const pingResult = await redis.ping();
      redisStatus = pingResult === "PONG" ? redis.status : "disconnected";
    } catch {
      redisStatus = redis.status || "disconnected";
    }
  }

  const dueCampaignCount = dueCampaignsWithCounts.length;
  const queueWaitingCount = Number(queueStats.waiting || 0);
  const activeWorkerCount = Number(workerStatus.active_worker_count || 0);

  let likelyFailureStage = "Queue";

  if (redisStatus !== "ready") {
    likelyFailureStage = "Redis";
  } else if (dueCampaignCount === 0) {
    likelyFailureStage = "DB";
  } else if (dueCampaignCount > 0 && queueWaitingCount === 0) {
    likelyFailureStage = "Scheduler";
  } else if (queueWaitingCount > 0 && activeWorkerCount === 0) {
    likelyFailureStage = "Worker";
  }

  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || "UTC";

  return {
    due_campaigns: dueCampaignsWithCounts,
    queue_health: queueStats,
    worker_status: workerStatus,
    redis_status: redisStatus,
    server_time: now.toISOString(),
    timezone,
    likely_failure_stage: likelyFailureStage,
  };
};
