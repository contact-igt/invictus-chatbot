/**
 * Centralised campaign pause / auto-resume control for Meta messaging errors.
 *
 * One place decides:
 *   - which classifier category maps to which pause_type
 *   - what is written to the structured pause columns (FIX 3)
 *   - which pauses the scheduler may auto-resume (FIX 2 / FIX 4)
 *
 * Used by both the synchronous campaign send worker and the asynchronous
 * `failed` status webhook, so both react identically to the same Meta error.
 */
import db from "../../database/index.js";
import { logger } from "../../utils/logger.js";
import { getIO } from "../../middlewares/socket/socket.js";
import {
  classifyMetaError,
  formatErrorForLogging,
} from "../../utils/metaErrorClassifier.js";
import {
  checkLocalWabaCapacity,
  computeLocalCapacityRetryAfter,
} from "../../services/metaMessagingLimit.service.js";

export const PAUSE_TYPES = Object.freeze({
  META_LOCAL_CAPACITY: "META_LOCAL_CAPACITY",
  META_SPAM_RESTRICTION: "META_SPAM_RESTRICTION",
  META_ACCOUNT_RESTRICTION: "META_ACCOUNT_RESTRICTION",
  META_AUTH_CONFIG: "META_AUTH_CONFIG",
  MANUAL: "MANUAL",
});

// classifier category → pause_type. Anything not listed here is NOT a
// campaign-level pause (recipient-scoped or retryable).
const CATEGORY_TO_PAUSE_TYPE = {
  LOCAL_CAPACITY: PAUSE_TYPES.META_LOCAL_CAPACITY,
  SPAM_RESTRICTION: PAUSE_TYPES.META_SPAM_RESTRICTION,
  ACCOUNT_RESTRICTION: PAUSE_TYPES.META_ACCOUNT_RESTRICTION,
  AUTH_CONFIG: PAUSE_TYPES.META_AUTH_CONFIG,
};

// Only local capacity is safely time-based auto-resumable.
export const AUTO_RESUMABLE_PAUSE_TYPES = new Set([
  PAUSE_TYPES.META_LOCAL_CAPACITY,
]);

const emitPaused = (tenantId, payload) => {
  try {
    getIO().to(`tenant-${tenantId}`).emit("campaign_paused", payload);
  } catch (err) {
    logger.warn(`[PAUSE-CONTROL] socket emit failed: ${err.message}`);
  }
};

const reasonFor = (pauseType, err) => {
  const detail = formatErrorForLogging(err);
  switch (pauseType) {
    case PAUSE_TYPES.META_LOCAL_CAPACITY:
      return `Local WABA messaging estimate reached the configured Meta tier limit. Sending will auto-resume as the rolling 24-hour window frees capacity. Meta remains the final authority. (${detail})`;
    case PAUSE_TYPES.META_SPAM_RESTRICTION:
      return `Meta has restricted messaging to protect ecosystem quality (spam/quality). Sending is paused; this does not auto-resume on a timer — review template quality and account health. (${detail})`;
    case PAUSE_TYPES.META_ACCOUNT_RESTRICTION:
      return `Meta has restricted or disabled this WhatsApp account. Sending is paused until the account is recovered and reconciled with Meta. (${detail})`;
    case PAUSE_TYPES.META_AUTH_CONFIG:
      return `WhatsApp API access error: ${detail}. Update your WhatsApp access token in Settings.`;
    default:
      return detail;
  }
};

/**
 * Pause campaign(s) for a classified Meta error and write structured metadata.
 *
 * @param {object} p
 * @param {string} p.tenantId
 * @param {Error}  p.error            original error (for classification + reason)
 * @param {string} [p.campaignId]     pause just this campaign; omitted → all active for tenant
 * @param {object} [p.classification] pre-computed classifyMetaError() result
 * @param {object} [p.account]        { waba_id, tier } — enables an accurate next_retry_at
 * @returns {Promise<{ paused:boolean, pauseType:string|null, affected:number, nextRetryAt:Date|null }>}
 */
export const pauseCampaignsForMetaError = async ({
  tenantId,
  error,
  campaignId = null,
  classification = null,
  account = null,
}) => {
  const cls = classification || classifyMetaError(error);
  const pauseType = CATEGORY_TO_PAUSE_TYPE[cls.category] || null;
  if (!pauseType) {
    return { paused: false, pauseType: null, affected: 0, nextRetryAt: null };
  }

  let nextRetryAt = null;
  if (pauseType === PAUSE_TYPES.META_LOCAL_CAPACITY) {
    nextRetryAt =
      (error && error.retry_after instanceof Date && error.retry_after) ||
      (account?.waba_id
        ? await computeLocalCapacityRetryAfter(account.waba_id)
        : new Date(Date.now() + 15 * 60 * 1000));
  }

  const now = new Date();
  const update = {
    status: "paused",
    pause_type: pauseType,
    pause_code: String(error?.code || cls.code || "").slice(0, 32) || null,
    paused_at: now,
    next_retry_at: nextRetryAt,
    paused_reason: reasonFor(pauseType, error),
  };

  const where = {
    tenant_id: tenantId,
    status: "active",
    is_deleted: false,
    ...(campaignId ? { campaign_id: campaignId } : {}),
  };

  const [affected] = await db.WhatsappCampaigns.update(update, { where });

  if (affected > 0) {
    logger.warn(
      `[PAUSE-CONTROL] Paused ${affected} campaign(s) tenant=${tenantId} type=${pauseType} nextRetryAt=${nextRetryAt ? nextRetryAt.toISOString() : "n/a"}`,
    );
    emitPaused(tenantId, {
      campaign_id: campaignId || null,
      all_campaigns: !campaignId,
      status: "paused",
      pause_type: pauseType,
      paused_reason: update.paused_reason,
      next_retry_at: nextRetryAt ? nextRetryAt.toISOString() : null,
      affected_count: affected,
    });
  }

  return { paused: affected > 0, pauseType, affected, nextRetryAt };
};

/**
 * Async `failed` status webhook entry point (FIX 8). Classifies the Meta error
 * carried on the delivery webhook and applies the SAME campaign-level pause the
 * synchronous worker would. Recipient-scoped categories are a no-op here — the
 * webhook's own recipient transaction already marks the recipient failed.
 */
export const handleAsyncMetaFailure = async ({
  tenantId,
  campaignId = null,
  metaErrors = [],
}) => {
  if (!tenantId || !Array.isArray(metaErrors) || metaErrors.length === 0) return;

  const first = metaErrors[0] || {};
  const pseudoError = {
    code: first.code,
    message: first.message || first.title || first.details,
    response: { data: { error: { code: first.code, error_data: first.error_data } } },
  };
  const cls = classifyMetaError(pseudoError);

  if (cls.category === "SPAM_RESTRICTION" || cls.category === "ACCOUNT_RESTRICTION") {
    await pauseCampaignsForMetaError({
      tenantId,
      error: pseudoError,
      campaignId, // pause just the affected campaign from an async signal
      classification: cls,
    });
  }
  // THROUGHPUT / PAIR_RATE_LIMIT / RECIPIENT_FREQUENCY / PERMANENT / TRANSIENT
  // → recipient-scoped; handled by the existing webhook recipient transaction.
};

/**
 * FIX 2 / FIX 4 — auto-resume scheduler step.
 *
 * Finds campaigns paused with pause_type = META_LOCAL_CAPACITY whose
 * next_retry_at has arrived, rechecks the live local WABA capacity, and either
 * re-activates them (caller then re-dispatches — pending recipients only) or
 * pushes next_retry_at forward.
 *
 * Never touches MANUAL / restriction / auth pauses. Never resends
 * sent/delivered/read/failed recipients — re-dispatch enqueues pending only.
 *
 * @returns {Promise<Array<{campaign_id:string, tenant_id:string}>>} campaigns re-activated
 */
export const resumeLocalCapacityPausedCampaigns = async () => {
  const now = new Date();

  const due = await db.sequelize.query(
    `SELECT c.campaign_id, c.tenant_id, wa.waba_id, wa.tier
       FROM whatsapp_campaigns c
       JOIN whatsapp_accounts wa
         ON wa.tenant_id = c.tenant_id AND wa.is_deleted = false
      WHERE c.status = 'paused'
        AND c.is_deleted = false
        AND c.pause_type = :pauseType
        AND (c.next_retry_at IS NULL OR c.next_retry_at <= :now)
      LIMIT 50`,
    {
      replacements: { pauseType: PAUSE_TYPES.META_LOCAL_CAPACITY, now },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );

  const reactivated = [];

  for (const row of due) {
    try {
      const capacity = await checkLocalWabaCapacity({
        waba_id: row.waba_id,
        tier: row.tier,
      });

      if (capacity.hasCapacity) {
        // Idempotent flip: only affects rows still paused with this exact type.
        const [affected] = await db.WhatsappCampaigns.update(
          {
            status: "active",
            pause_type: null,
            pause_code: null,
            paused_reason: null,
            next_retry_at: null,
          },
          {
            where: {
              campaign_id: row.campaign_id,
              status: "paused",
              pause_type: PAUSE_TYPES.META_LOCAL_CAPACITY,
              is_deleted: false,
            },
          },
        );
        if (affected > 0) {
          reactivated.push({
            campaign_id: row.campaign_id,
            tenant_id: row.tenant_id,
          });
          try {
            getIO()
              .to(`tenant-${row.tenant_id}`)
              .emit("campaign-status-update", {
                campaign_id: row.campaign_id,
                status: "active",
                resumed: true,
                pause_type: PAUSE_TYPES.META_LOCAL_CAPACITY,
              });
          } catch {
            /* best-effort */
          }
          logger.info(
            `[PAUSE-CONTROL] Auto-resumed campaign ${row.campaign_id} (local capacity ${capacity.used}/${capacity.limit})`,
          );
        }
      } else {
        const next =
          capacity.retryAfter instanceof Date
            ? capacity.retryAfter
            : new Date(Date.now() + 15 * 60 * 1000);
        await db.WhatsappCampaigns.update(
          { next_retry_at: next },
          {
            where: {
              campaign_id: row.campaign_id,
              status: "paused",
              pause_type: PAUSE_TYPES.META_LOCAL_CAPACITY,
            },
          },
        );
        logger.info(
          `[PAUSE-CONTROL] Campaign ${row.campaign_id} still at local capacity (${capacity.used}/${capacity.limit}); next check ${next.toISOString()}`,
        );
      }
    } catch (err) {
      logger.error(
        `[PAUSE-CONTROL] resume check failed for ${row.campaign_id}: ${err.message}`,
      );
    }
  }

  return reactivated;
};
