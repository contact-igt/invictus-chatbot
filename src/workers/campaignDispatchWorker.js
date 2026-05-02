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
import { logger } from "../utils/logger.js";
import {
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

const PAGE_SIZE = parseInt(process.env.CAMPAIGN_DISPATCH_PAGE_SIZE || "500");
const LOCK_TTL = parseInt(process.env.CAMPAIGN_DISPATCH_LOCK_TTL || "120"); // seconds

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
          300,
        ); // 5 min TTL

        if (!reservationResult.success) {
          logger.warn(
            `[DISPATCH-WORKER] Campaign ${campaign_id} billing reservation failed — ${reservationResult.reason}`,
          );
          await campaign.update({ status: "paused" });
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

    // ── Enqueue send jobs (deduplicated by jobId) ─────────────────────────
    let enqueued = 0;
    for (const recipient of recipients) {
      try {
        await sendQueue.add(
          "send-recipient",
          { campaign_id, tenant_id, recipient_id: recipient.id },
          {
            // BullMQ dedup: a job with the same jobId in waiting/active/delayed
            // state is silently ignored — prevents duplicate sends.
            jobId: `send:${recipient.id}`,
          },
        );
        enqueued++;
      } catch (addErr) {
        // Duplicate jobId collision is expected and safe — log others
        if (!addErr.message?.includes("already exists")) {
          logger.warn(
            `[DISPATCH-WORKER] Could not enqueue recipient ${recipient.id}: ${addErr.message}`,
          );
        }
      }
    }

    logger.info(
      `[DISPATCH-WORKER] Campaign ${campaign_id} — enqueued ${enqueued}/${recipients.length} send jobs into ${sendQueue?.name || "tenant queue"}`,
    );

    if (billingReservation) {
      consumedBillingAmount = Number((perRecipientCost * enqueued).toFixed(6));
      billingSettlement = consumedBillingAmount > 0 ? "confirm" : "release";
    }

    logger.info(
      `[DISPATCH-WORKER] send jobs added for campaign ${campaign_id}: ${enqueued}`,
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
            await billingService.releaseReservation(
              tenant_id,
              billingReservation,
            );
            logger.warn(
              `[DISPATCH-WORKER] Billing reservation confirmation failed, released instead: ${billingReservation}`,
            );
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
        logger.warn(
          `[DISPATCH-WORKER] Failed to settle billing reservation ${billingReservation}: ${err.message}`,
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
