/**
 * Campaign Dispatch Worker
 *
 * BullMQ worker that processes campaign-dispatch jobs.
 * Each job reads a page of pending recipients for one campaign, enqueues
 * individual campaign-send jobs, and fans out to the next page when the
 * current page is full.
 *
 * Responsibilities:
 *   - Acquire a Redis distributed lock (prevents concurrent dispatch for the
 *     same campaign even if the cron fires multiple times or multiple Node
 *     processes run simultaneously).
 *   - Perform a single billing check per dispatch page (not per recipient).
 *   - Enqueue campaign-send jobs with jobId = "send:{recipient_id}" for
 *     deduplication — BullMQ silently ignores duplicate job IDs.
 *   - Fan-out: if the current page was full, enqueue the next dispatch page.
 *   - Mark the campaign completed when no pending recipients remain.
 */
import { Worker } from "bullmq";
import { pathToFileURL } from "url";
import { logger } from "../utils/logger.js";
import {
  initCampaignQueues,
  getRedisConnection,
  getCampaignDispatchQueue,
  getCampaignDispatchQueueName,
  getTenantQueue,
  isCampaignQueueAvailable,
} from "../queues/campaignQueue.js";
import { estimateMetaCost } from "../utils/billing/costEstimator.js";
import { getRedisLock } from "../utils/redis/redisLock.js";
import { getCampaignBillingService } from "../services/campaignBillingService.js";
import db from "../database/index.js";
import { ensureTenantSendWorker } from "./campaignSendWorker.js";
import { recordCampaignDiagnosticEvent } from "../utils/campaignDiagnosticsEvents.js";
import { getIO } from "../middlewares/socket/socket.js";
import * as dispatchCampaign from "./dispatchCampaign.js";
const enqueueSendJobs =
  dispatchCampaign.enqueueSendJobs ||
  (dispatchCampaign.default && dispatchCampaign.default.enqueueSendJobs);

if (!enqueueSendJobs) {
  logger.warn(
    "[DISPATCH-WORKER] dispatchCampaign.enqueueSendJobs not found — dispatch will fail until module exports are available",
  );
}

const PAGE_SIZE = parseInt(process.env.CAMPAIGN_DISPATCH_PAGE_SIZE || "500");
const LOCK_TTL = parseInt(process.env.CAMPAIGN_DISPATCH_LOCK_TTL || "120"); // seconds
const BILLING_RESERVATION_TTL = parseInt(
  process.env.CAMPAIGN_BILLING_RESERVATION_TTL || "1800",
  10,
);

const emitCampaignPaused = (tenant_id, campaign_id, paused_reason) => {
  try {
    const io = getIO();
    const payload = { campaign_id, status: "paused", paused_reason };
    io.to(`tenant-${tenant_id}`).emit("campaign_paused", payload);
    io.to(`tenant-${tenant_id}`).emit("campaign-status-update", payload);
  } catch (err) {
    logger.warn(
      `[DISPATCH-WORKER] Failed to emit campaign_paused for ${campaign_id}: ${err.message}`,
    );
  }
};

// ── Core processor ────────────────────────────────────────────────────────────

async function processDispatchJob(job) {
  const { campaign_id, tenant_id, after_id = 0 } = job.data;
  logger.info(
    `[DISPATCH-WORKER] Processing campaign ${campaign_id} for tenant ${tenant_id}`,
  );
  logger.info(
    `[DISPATCH-WORKER] Processing dispatch job campaign=${campaign_id} tenant=${tenant_id} after_id=${after_id}`,
  );
  recordCampaignDiagnosticEvent({
    source: "dispatch-worker",
    type: "worker_processed",
    message: `Dispatch processing campaign=${campaign_id} tenant=${tenant_id} after_id=${after_id}`,
    meta: { campaign_id, tenant_id, after_id, job_id: job.id },
  });

  const redis = getRedisConnection();
  const dispatchQueue = getCampaignDispatchQueue();
  let sendQueue = null;
  let billingReservation = null;
  let billingSettlement = "none";
  let consumedBillingAmount = 0;

  if (!redis || !dispatchQueue) {
    logger.warn(
      `[DISPATCH-WORKER] Queue/Redis not available for campaign ${campaign_id} — skipping`,
    );
    return;
  }

  try {
    sendQueue = getTenantQueue(tenant_id);
    ensureTenantSendWorker(tenant_id);
  } catch (err) {
    logger.warn(
      `[DISPATCH-WORKER] Tenant queue unavailable for tenant ${tenant_id}: ${err.message}`,
    );
    return;
  }

  const redisLock = getRedisLock(redis);
  const billingService = getCampaignBillingService(redis);

  // ── Acquire improved distributed Redis lock ─────────────────────────────────
  const lockKey = `campaign:dispatch:${campaign_id}`;
  const lockResult = await redisLock.acquireWithRetry(lockKey, LOCK_TTL, 3);

  if (!lockResult.success) {
    logger.info(
      `[DISPATCH-WORKER] Failed to acquire lock for campaign ${campaign_id} — skipping this tick`,
    );
    return;
  }

  const { release: releaseLock } = lockResult;

  try {
    // ── Load campaign ─────────────────────────────────────────────────────
    const campaign = await db.WhatsappCampaigns.findOne({
      where: { campaign_id, tenant_id, is_deleted: false },
      attributes: ["id", "campaign_id", "tenant_id", "status", "template_id"],
    });

    if (!campaign) {
      logger.warn(`[DISPATCH-WORKER] Campaign ${campaign_id} not found`);
      return;
    }

    if (campaign.status === "scheduled") {
      await campaign.update({ status: "active" });
      logger.info(
        `[DISPATCH-WORKER] Campaign ${campaign_id} moved scheduled -> active before dispatch`,
      );
    }

    if (["paused", "cancelled", "completed"].includes(campaign.status)) {
      logger.info(
        `[DISPATCH-WORKER] Campaign ${campaign_id} is ${campaign.status} — skipping dispatch`,
      );
      return;
    }

    const campaignIdForBillingCheck = String(
      job?.data?.campaignId || campaign_id || "",
    ).trim();
    const isPerfTestCampaign =
      campaignIdForBillingCheck.startsWith("perf_") ||
      campaignIdForBillingCheck.startsWith("e2e_");

    // ── Billing check with atomic reservation ─────────────────
    // ── Fetch a page of pending recipients (keyset pagination for performance) ─────────────────
    const whereClause = {
      campaign_id,
      status: "pending",
      is_deleted: false,
    };
    if (after_id > 0) {
      whereClause.id = { [db.Sequelize.Op.gt]: after_id }; // Keyset pagination
    }

    const recipients = await db.WhatsappCampaignRecipients.findAll({
      where: whereClause,
      order: [["id", "ASC"]],
      limit: PAGE_SIZE,
      attributes: ["id", "mobile_number"],
    });

    logger.info(
      `[DISPATCH-WORKER] Campaign ${campaign_id} — found ${recipients.length} pending recipients (after_id=${after_id})`,
    );
    logger.info(
      `[DISPATCH-WORKER] recipient count for campaign ${campaign_id}: ${recipients.length}`,
    );

    // Debug: log remaining pending count and status
    try {
      const remainingPending = await db.WhatsappCampaignRecipients.count({
        where: { campaign_id, status: "pending", is_deleted: false },
      });
      logger.info(
        `[DISPATCH-WORKER] campaign_id=${campaign_id} remaining_pending=${remainingPending} status=${campaign.status}`,
      );
    } catch (e) {
      logger.debug(
        `[DISPATCH-WORKER] Could not compute remaining pending for ${campaign_id}: ${e.message}`,
      );
    }

    // ── Billing check with atomic reservation (use actual page size) ─────────────────
    let perRecipientCost = 0;
    if (recipients.length > 0) {
      if (isPerfTestCampaign) {
      } else {
        try {
          const template = await db.WhatsappTemplates.findOne({
            where: { template_id: campaign.template_id },
            attributes: ["category"],
            raw: true,
          });
          const category = (template?.category || "marketing").toLowerCase();

          const tenant = await db.Tenants.findOne({
            where: { tenant_id },
            attributes: ["country", "owner_country_code", "timezone"],
            raw: true,
          });
          const isIndia =
            tenant?.owner_country_code === "91" ||
            tenant?.timezone === "Asia/Kolkata";
          const billingCountry = tenant?.country || (isIndia ? "IN" : "Global");

          const cost = await estimateMetaCost(category, billingCountry);
          perRecipientCost = Number(cost.totalCostInr) || 0;
          const batchCost = perRecipientCost * recipients.length;

          const reservationResult = await billingService.createReservation(
            tenant_id,
            batchCost,
            BILLING_RESERVATION_TTL,
            campaign_id,
          ); // 5 min TTL

          if (!reservationResult.success) {
            logger.warn(
              `[DISPATCH-WORKER] Campaign ${campaign_id} billing reservation failed — ${reservationResult.reason}`,
            );
            const pausedReason =
              reservationResult.reason ||
              `Insufficient wallet balance - required INR ${batchCost}`;
            await campaign.update({
              status: "paused",
              paused_reason: pausedReason,
            });
            emitCampaignPaused(tenant_id, campaign_id, pausedReason);
            return;
          }

          billingReservation = reservationResult.reservationId;
          billingSettlement = "release";
          logger.info(
            `[DISPATCH-WORKER] Billing reservation created: ${billingReservation} for ₹${batchCost}`,
          );
        } catch (billingErr) {
          logger.error(
            `[DISPATCH-WORKER] Billing check error for ${campaign_id}: ${billingErr.message}`,
          );
          return;
        }
      }
    }

    // ── No recipients — check whether campaign is truly finished ──────────
    if (recipients.length === 0) {
      const remainingPending = await db.WhatsappCampaignRecipients.count({
        where: { campaign_id, status: "pending", is_deleted: false },
      });

      logger.info(
        `[DISPATCH-WORKER] campaign_id=${campaign_id} remaining_pending=${remainingPending} status=${campaign.status}`,
      );

      if (remainingPending === 0) {
        await db.WhatsappCampaigns.update(
          { status: "completed" },
          {
            where: {
              campaign_id,
              status: {
                [db.Sequelize.Op.in]: [
                  "active",
                  "failed",
                  "scheduled",
                  "draft",
                ],
              },
            },
          },
        );
        logger.info(
          `[DISPATCH-WORKER] Campaign ${campaign_id} marked completed (remaining_pending=0)`,
        );
      }
      return;
    }

    // Re-check status after loading the page. This catches campaigns paused
    // while the worker was building the page and prevents additional sends.
    const latestCampaignStatus = await db.WhatsappCampaigns.findOne({
      where: { campaign_id, tenant_id, is_deleted: false },
      attributes: ["status"],
      raw: true,
    });

    if (
      !latestCampaignStatus ||
      ["paused", "cancelled", "completed"].includes(latestCampaignStatus.status)
    ) {
      logger.info(
        `[DISPATCH-WORKER] Campaign ${campaign_id} is ${latestCampaignStatus?.status || "missing"} — stopping before enqueue`,
      );
      return;
    }

    // ── Enqueue send jobs using addBulk with chunking and fallback ─────────
    const { totalEnqueued, totalFailed, durationMs } = await enqueueSendJobs(
      sendQueue,
      campaign.campaign_id || campaign_id,
      tenant_id,
      recipients,
    );

    const enqueued = totalEnqueued;
    if (billingReservation) {
      const statusBeforeFanOut = await db.WhatsappCampaigns.findOne({
        where: { campaign_id, tenant_id, is_deleted: false },
        attributes: ["status"],
        raw: true,
      });

      if (
        !statusBeforeFanOut ||
        ["paused", "cancelled", "completed"].includes(statusBeforeFanOut.status)
      ) {
        logger.info(
          `[DISPATCH-WORKER] Campaign ${campaign_id} is ${statusBeforeFanOut?.status || "missing"} — skipping fan-out`,
        );
        return;
      }

      consumedBillingAmount = Number((perRecipientCost * enqueued).toFixed(6));
      billingSettlement = consumedBillingAmount > 0 ? "confirm" : "release";
    }

    logger.info(
      `[DISPATCH-WORKER] Campaign ${campaign_id} — enqueued ${enqueued}/${recipients.length} send jobs into ${sendQueue?.name || "tenant queue"}`,
    );

    recordCampaignDiagnosticEvent({
      source: "dispatch-worker",
      type: "jobs_added",
      message: `Enqueued ${enqueued}/${recipients.length} jobs for campaign ${campaign_id}`,
      meta: {
        campaign_id,
        tenant_id,
        enqueued,
        recipients: recipients.length,
        queue_name: sendQueue?.name || null,
        failed: totalFailed,
        enqueue_duration_ms: durationMs,
      },
    });

    // ── Fan-out: if this page was full, enqueue the next page immediately ─
    if (recipients.length === PAGE_SIZE) {
      const nextAfterId = recipients[recipients.length - 1].id;
      await dispatchQueue.add(
        "campaign-dispatch",
        { campaign_id, tenant_id, after_id: nextAfterId },
        {
          // Unique per cursor position — cron re-uses jobId "dispatch:X:0"
          // for the initial page; fan-out pages use the cursor id.
          jobId: `dispatch:${campaign_id}:${nextAfterId}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      logger.info(
        `[DISPATCH-WORKER] Campaign ${campaign_id} — queued next page (after_id=${nextAfterId})`,
      );
    }
  } finally {
    // Settle billing reservation if it exists
    if (billingReservation) {
      try {
        if (billingSettlement === "confirm") {
          const confirmed = await billingService.confirmReservation(
            tenant_id,
            billingReservation,
            consumedBillingAmount,
          );

          if (confirmed) {
            logger.debug(
              `[DISPATCH-WORKER] Billing reservation confirmed: ${billingReservation} (consumed ₹${consumedBillingAmount})`,
            );
          } else {
            logger.error(
              `[DISPATCH-WORKER] ALERT billing reservation confirmation failed for ${billingReservation} campaign=${campaign_id} tenant=${tenant_id} consumed=${consumedBillingAmount}. Attempting release.`,
            );
            const released = await billingService.releaseReservation(
              tenant_id,
              billingReservation,
            );
            if (!released) {
              logger.error(
                `[DISPATCH-WORKER] ALERT billing reservation ${billingReservation} could not be confirmed or released; wallet discrepancy requires reconciliation.`,
              );
            }
          }
        } else {
          await billingService.releaseReservation(
            tenant_id,
            billingReservation,
          );
          logger.debug(
            `[DISPATCH-WORKER] Billing reservation released: ${billingReservation}`,
          );
        }
      } catch (err) {
        logger.error(
          `[DISPATCH-WORKER] ALERT failed to settle billing reservation ${billingReservation} campaign=${campaign_id} tenant=${tenant_id}: ${err.message}`,
        );
      }
    }

    // Release distributed lock
    try {
      await releaseLock();
    } catch (err) {
      logger.warn(
        `[DISPATCH-WORKER] Failed to release lock for campaign ${campaign_id}: ${err.message}`,
      );
    }
  }
}

// ── Worker lifecycle ──────────────────────────────────────────────────────────

let dispatchWorker = null;

export const startCampaignDispatchWorker = () => {
  if (!isCampaignQueueAvailable()) {
    logger.warn(
      "[DISPATCH-WORKER] Campaign queue unavailable — worker not started (cron handles execution)",
    );
    return;
  }

  if (dispatchWorker) {
    // Replace any stale worker (e.g. bound to a connection that was torn down)
    // so we never run two dispatch workers against the same queue.
    try {
      void dispatchWorker.close();
    } catch {
      // ignore
    }
    dispatchWorker = null;
  }

  const connection = getRedisConnection();
  const concurrency = parseInt(
    process.env.CAMPAIGN_DISPATCH_CONCURRENCY || "10",
  );
  const dispatchQueueName = getCampaignDispatchQueueName();

  dispatchWorker = new Worker(dispatchQueueName, processDispatchJob, {
    connection,
    concurrency,
  });

  dispatchWorker.on("failed", (job, err) => {
    logger.error(`[DISPATCH-WORKER] Job ${job?.id} failed: ${err.message}`);
  });

  dispatchWorker.on("error", (err) => {
    logger.error(`[DISPATCH-WORKER] Worker error: ${err.message}`);
  });

  logger.info(
    `[DISPATCH-WORKER] Started — queue=${dispatchQueueName} concurrency=${concurrency} pageSize=${PAGE_SIZE}`,
  );
  recordCampaignDiagnosticEvent({
    source: "dispatch-worker",
    type: "worker_started",
    message: `Dispatch worker started (concurrency=${concurrency})`,
    meta: { concurrency, page_size: PAGE_SIZE },
  });
};

export const getDispatchWorkerStatus = () => ({
  running: Boolean(dispatchWorker),
  worker_type: "campaign-dispatch",
  active_worker_count: dispatchWorker ? 1 : 0,
});

export const closeDispatchWorker = async () => {
  if (dispatchWorker) {
    await dispatchWorker.close();
    logger.info("[DISPATCH-WORKER] Closed");
  }
};

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const startStandaloneDispatchWorker = async () => {
    try {
      await initCampaignQueues();

      if (!isCampaignQueueAvailable()) {
        logger.error(
          "[DISPATCH-WORKER] Campaign queue unavailable. Check REDIS_URL and Redis service before starting worker.",
        );
        process.exit(1);
      }

      startCampaignDispatchWorker();

      process.on("SIGINT", async () => {
        await closeDispatchWorker();
        process.exit(0);
      });

      process.stdin.resume();
    } catch (err) {
      console.error("Dispatch worker failed to start:", err);
      process.exit(1);
    }
  };

  startStandaloneDispatchWorker();
}
