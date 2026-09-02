import cron from "node-cron";
import { logger } from "../utils/logger.js";
import { getRedisConnection } from "../queues/campaignQueue.js";
import db from "../database/index.js";

// Per-environment keyspace isolation — must match campaignBillingService.js.
// Without it this cron scans and deletes the OTHER environment's live
// reservations (Stage + Production share one Redis).
const KEY_PREFIX = (() => {
  const env = String(process.env.BULLMQ_QUEUE_PREFIX || "").trim();
  return env ? `${env}:` : "";
})();

/**
 * B-2: Reconciliation cron for orphaned Redis reservation keys.
 *
 * Problem: When a campaign dispatch starts, a reservation:{tenant_id}-{campaign_id}
 * key is created in Redis to hold the tenancy's credit from their wallet.
 * If the process crashes mid-dispatch, this key can be abandoned indefinitely,
 * leaving credit locked forever.
 *
 * Solution: Every 15 minutes, scan Redis for reservation:* keys, check the
 * campaign's finalization status, and either:
 *  - Confirm charge (reservation held, campaign completed with success)
 *  - Release credit (campaign failed, or abandoned >30 minutes)
 *
 * Ensures no orphaned reservations linger.
 */

const SCAN_INTERVAL = "*/15 * * * *"; // Every 15 minutes
const ABANDONED_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Scans Redis for all reservation:* keys and reconciles them against
 * campaign finalization status in the database.
 */
const reconcileOrphanedReservations = async () => {
  const redis = getRedisConnection();
  if (!redis) {
    logger.warn(
      "[BILLING-RECONCILIATION] Redis unavailable — skipping reconciliation",
    );
    return;
  }

  try {
    let cursor = "0";
    const batchSize = 100;
    let processedCount = 0;
    let releasedCount = 0;
    let confirmedCount = 0;

    logger.info(
      "[BILLING-RECONCILIATION] Starting scan for orphaned reservations",
    );

    do {
      // Scan Redis for keys matching pattern <prefix>reservation:*
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${KEY_PREFIX}reservation:*`,
        "COUNT",
        batchSize,
      );
      cursor = nextCursor;

      if (!keys || keys.length === 0) continue;

      for (const key of keys) {
        try {
          const keyType = await redis.type(key);
          if (keyType !== "hash") {
            logger.warn(
              `[BILLING-RECONCILIATION] Skipping unstructured reservation key ${key} type=${keyType}. Cannot safely reconcile without tenant_id/campaign_id metadata.`,
            );
            continue;
          }

          // Get reservation metadata (amount, creation time)
          const reservationData = await redis.hgetall(key);
          const tenantId = reservationData?.tenant_id;
          const campaignId = reservationData?.campaign_id;
          if (!tenantId || !campaignId) {
            logger.warn(
              `[BILLING-RECONCILIATION] Skipping reservation key ${key} with missing tenant_id/campaign_id metadata`,
            );
            continue;
          }

          processedCount++;

          const createdAt = reservationData?.created_at
            ? new Date(reservationData.created_at)
            : null;
          const amount = parseFloat(reservationData?.amount || "0");

          // Check campaign status
          const campaign = await db.WhatsappCampaigns.findOne({
            where: {
              campaign_id: campaignId,
              tenant_id: tenantId,
              is_deleted: false,
            },
            attributes: ["campaign_id", "status", "created_at", "updated_at"],
            raw: true,
          });

          if (!campaign) {
            // Campaign not found or soft-deleted — release reservation
            logger.warn(
              `[BILLING-RECONCILIATION] Campaign ${campaignId} not found for tenant ${tenantId} — releasing reservation (₹${amount.toFixed(2)})`,
            );
            await redis.del(key);
            releasedCount++;
            continue;
          }

          const now = Date.now();
          const isAbandoned =
            createdAt && now - createdAt.getTime() > ABANDONED_THRESHOLD_MS;

          if (campaign.status === "completed" || campaign.status === "failed") {
            // Campaign finalized — confirm charge (keep reservation to mark as billed)
            logger.info(
              `[BILLING-RECONCILIATION] Campaign ${campaignId} finalized as '${campaign.status}' — confirming charge (₹${amount.toFixed(2)})`,
            );
            // Reservation stays in Redis as evidence of billing (optional: mark confirmed timestamp)
            await redis.hset(key, "confirmed_at", new Date().toISOString());
            confirmedCount++;
          } else if (isAbandoned) {
            // Campaign still active but >30 minutes old — assume stuck, release
            logger.warn(
              `[BILLING-RECONCILIATION] Campaign ${campaignId} abandoned >30min (status='${campaign.status}') — releasing reservation (₹${amount.toFixed(2)})`,
            );
            await redis.del(key);
            releasedCount++;
          } else {
            // Campaign still active and recent — leave reservation alone
            logger.debug(
              `[BILLING-RECONCILIATION] Campaign ${campaignId} still active and recent — leaving reservation`,
            );
          }
        } catch (err) {
          logger.error(
            `[BILLING-RECONCILIATION] Error processing reservation key ${key}: ${err.message}`,
          );
          // Continue to next key
        }
      }
    } while (cursor !== "0");

    logger.info(
      `[BILLING-RECONCILIATION] Scan complete: processed=${processedCount}, released=${releasedCount}, confirmed=${confirmedCount}`,
    );
  } catch (err) {
    logger.error(
      `[BILLING-RECONCILIATION] Failed to reconcile reservations: ${err.message}`,
    );
  }
};

/**
 * Initializes and schedules the reconciliation cron.
 * Called once at app startup.
 */
export const initBillingReconciliationCron = () => {
  try {
    logger.info(
      "[BILLING-RECONCILIATION] Initializing cron (every 15 minutes)",
    );
    cron.schedule(SCAN_INTERVAL, async () => {
      logger.debug("[BILLING-RECONCILIATION] Cron triggered");
      await reconcileOrphanedReservations();
    });
  } catch (err) {
    logger.error(
      `[BILLING-RECONCILIATION] Failed to initialize cron: ${err.message}`,
    );
  }
};
