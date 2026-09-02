import { randomUUID } from "crypto";
import db from "../database/index.js";
import { resolveMetaTier } from "../utils/metaMessagingTier.js";
import { logger } from "../utils/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const normalizeMetaRecipient = (phone) =>
  String(phone || "").replace(/\D/g, "");

export const hasOpenCustomerServiceWindow = async (tenantId, recipientPhone) => {
  // BUG-1 fix: with QueryTypes.SELECT the result IS the rows array — do NOT
  // destructure `const [rows]` (that binds `rows` to the first row / undefined).
  //
  // Phase 2: match the stored number using the SAME digits-only rule as
  // normalizeMetaRecipient() (`\D` → ""), instead of a partial 5-char REPLACE
  // chain that missed '.', '/', etc.
  const rows = await db.sequelize.query(
    `SELECT 1
       FROM messages
      WHERE tenant_id = :tenantId
        AND sender = 'user'
        AND created_at >= :windowStart
        AND REGEXP_REPLACE(
              CONCAT(COALESCE(country_code, ''), COALESCE(phone, '')),
              '[^0-9]', '') = :recipientPhone
      LIMIT 1`,
    {
      replacements: {
        tenantId,
        recipientPhone,
        windowStart: new Date(Date.now() - DAY_MS),
      },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );
  return rows.length > 0;
};

export const reserveMetaMessagingRecipient = async ({
  account,
  tenantId,
  recipient,
  templateName,
}) => {
  const recipientPhone = normalizeMetaRecipient(recipient);
  if (!recipientPhone || !account?.waba_id) return null;

  if (await hasOpenCustomerServiceWindow(tenantId, recipientPhone)) {
    return null;
  }

  const tier = resolveMetaTier(account.tier);
  const sentAt = new Date();
  const windowStart = new Date(sentAt.getTime() - DAY_MS);

  return db.sequelize.transaction(async (transaction) => {
    await db.Whatsappaccount.findAll({
      where: { waba_id: account.waba_id, is_deleted: false },
      attributes: ["id"],
      lock: transaction.LOCK.UPDATE,
      transaction,
    });

    if (tier.isKnown && !tier.isUnlimited) {
      const [rows] = await db.sequelize.query(
        `SELECT
           COUNT(DISTINCT recipient_phone) AS used,
           MAX(CASE WHEN recipient_phone = :recipientPhone THEN 1 ELSE 0 END) AS already_counted
         FROM meta_messaging_limit_events
         WHERE waba_id = :wabaId
           AND qualifies = true
           AND status IN ('reserved', 'sent', 'delivered', 'read')
           AND sent_at >= :windowStart`,
        {
          replacements: {
            recipientPhone,
            wabaId: account.waba_id,
            windowStart,
          },
          type: db.sequelize.QueryTypes.SELECT,
          transaction,
        },
      );
      const used = Number(rows?.used || 0);
      const alreadyCounted = Number(rows?.already_counted || 0) === 1;

      if (!alreadyCounted && used >= tier.dailyLimit) {
        // FIX 1: when the earliest currently-counted UNIQUE recipient passes the
        // 24h mark, one slot frees up. Compute that boundary; if it is already
        // in the past (clock skew / a slot expired mid-request) fall back to a
        // short retry so we recheck immediately rather than pausing forever.
        const retryAfter = await computeLocalCapacityRetryAfter(
          account.waba_id,
          transaction,
        );

        const error = new Error(
          `Local WABA messaging estimate reached the configured Meta tier limit (${used}/${tier.dailyLimit} unique recipients in the rolling 24-hour window). Meta remains the final authority.`,
        );
        error.code = "LOCAL_META_TIER_LIMIT";
        error.meta_local_capacity = true; // specific marker (not meta_account_restriction)
        error.retry_after = retryAfter;
        error.tier_daily_limit = tier.dailyLimit;
        error.local_used = used;
        throw error;
      }
    }

    const event = await db.MetaMessagingLimitEvents.create(
      {
        reservation_id: randomUUID(),
        tenant_id: tenantId,
        waba_id: account.waba_id,
        phone_number_id: account.phone_number_id,
        recipient_phone: recipientPhone,
        template_name: templateName || null,
        status: "reserved",
        qualifies: true,
        sent_at: sentAt,
      },
      { transaction },
    );

    return event.reservation_id;
  });
};

const MIN_RETRY_MS = 60 * 1000; // never schedule a recheck sooner than 1 minute

/**
 * FIX 1 — when will the next local unique-recipient slot free up?
 *
 * The rolling window counts DISTINCT recipient_phone. A recipient's slot is held
 * until 24h after that recipient's *earliest* qualifying send. So the next slot
 * to free is:  MIN(per-recipient MIN(sent_at))  +  24h.
 *
 * Returns a Date. Guaranteed to be at least `now + MIN_RETRY_MS` so the resume
 * scheduler always makes forward progress; a caller that finds capacity already
 * free on recheck simply proceeds instead of pausing.
 */
export const computeLocalCapacityRetryAfter = async (wabaId, transaction = null) => {
  const now = Date.now();
  const fallback = new Date(now + MIN_RETRY_MS);
  if (!wabaId) return fallback;

  try {
    const [rows] = await db.sequelize.query(
      `SELECT MIN(first_sent_at) AS oldest_slot
         FROM (
           SELECT recipient_phone, MIN(sent_at) AS first_sent_at
             FROM meta_messaging_limit_events
            WHERE waba_id = :wabaId
              AND qualifies = true
              AND status IN ('reserved','sent','delivered','read')
              AND sent_at >= :windowStart
            GROUP BY recipient_phone
         ) AS per_recipient`,
      {
        replacements: {
          wabaId,
          windowStart: new Date(now - DAY_MS),
        },
        type: db.sequelize.QueryTypes.SELECT,
        ...(transaction ? { transaction } : {}),
      },
    );

    const oldest = rows?.oldest_slot ? new Date(rows.oldest_slot) : null;
    if (!oldest || Number.isNaN(oldest.getTime())) return fallback;

    const slotFreesAt = new Date(oldest.getTime() + DAY_MS);
    return slotFreesAt.getTime() > now + MIN_RETRY_MS ? slotFreesAt : fallback;
  } catch (error) {
    logger.warn(
      `[META-LIMIT] computeLocalCapacityRetryAfter failed for ${wabaId}: ${error.message}`,
    );
    return fallback;
  }
};

/**
 * Recompute the current local 24h unique-recipient usage for a WABA against the
 * tier limit. Used by the resume scheduler to decide whether a paused campaign
 * can go active again.
 *
 * @returns {{ used:number, limit:number|null, hasCapacity:boolean, retryAfter:Date|null }}
 */
export const checkLocalWabaCapacity = async (account) => {
  const tier = resolveMetaTier(account?.tier);
  if (!account?.waba_id || !tier.isKnown || tier.isUnlimited) {
    return { used: 0, limit: tier.dailyLimit, hasCapacity: true, retryAfter: null };
  }

  const [rows] = await db.sequelize.query(
    `SELECT COUNT(DISTINCT recipient_phone) AS used
       FROM meta_messaging_limit_events
      WHERE waba_id = :wabaId
        AND qualifies = true
        AND status IN ('reserved','sent','delivered','read')
        AND sent_at >= :windowStart`,
    {
      replacements: {
        wabaId: account.waba_id,
        windowStart: new Date(Date.now() - DAY_MS),
      },
      type: db.sequelize.QueryTypes.SELECT,
    },
  );
  const used = Number(rows?.used || 0);
  const hasCapacity = used < tier.dailyLimit;
  return {
    used,
    limit: tier.dailyLimit,
    hasCapacity,
    retryAfter: hasCapacity
      ? null
      : await computeLocalCapacityRetryAfter(account.waba_id),
  };
};

export const confirmMetaMessagingReservation = async (reservationId, wamid) => {
  if (!reservationId) return;
  await db.MetaMessagingLimitEvents.update(
    { status: "sent", wamid: wamid || null },
    { where: { reservation_id: reservationId } },
  );
};

export const releaseMetaMessagingReservation = async (reservationId) => {
  if (!reservationId) return;
  await db.MetaMessagingLimitEvents.destroy({
    where: { reservation_id: reservationId, status: "reserved" },
  });
};

/**
 * Convert Meta's `statuses[].timestamp` (seconds, string or number) to a Date.
 * Returns null for missing / non-numeric / clearly-bogus values so callers can
 * fall back to server time.
 */
export const metaTimestampToDate = (raw) => {
  if (raw === null || raw === undefined || raw === "") return null;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  const ms = secs * 1000;
  // sanity window: 2015-01-01 .. now + 1 day
  if (ms < 1420070400000 || ms > Date.now() + DAY_MS) return null;
  return new Date(ms);
};

const MAX_UNMATCHED_RETRIES = 5;
const UNMATCHED_RETRY_BACKOFF_MS = [3000, 8000, 20000, 60000, 180000];

const persistUnmatchedStatusEvent = async ({ wamid, status, eventAt, payload }) => {
  try {
    await db.sequelize.query(
      `INSERT INTO meta_unmatched_status_events
         (wamid, status, meta_timestamp, payload, retry_count, next_retry_at, created_at, updated_at)
       VALUES (:wamid, :status, :ts, :payload, 0, :next, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         meta_timestamp = COALESCE(meta_unmatched_status_events.meta_timestamp, VALUES(meta_timestamp)),
         updated_at = NOW()`,
      {
        replacements: {
          wamid,
          status,
          ts: eventAt instanceof Date ? eventAt : null,
          payload: payload ? JSON.stringify(payload).slice(0, 8000) : null,
          next: new Date(Date.now() + UNMATCHED_RETRY_BACKOFF_MS[0]),
        },
      },
    );
  } catch (e) {
    logger.warn(`[META-LIMIT] Could not persist unmatched status ${wamid}: ${e.message}`);
  }
};

/**
 * R-3 hardening: apply a delivery/read/failed signal to the ledger row.
 * If no ledger row matches the wamid yet (webhook beat the confirm commit),
 * durably record it for a bounded retry instead of silently dropping it.
 *
 * @param {string} wamid
 * @param {'delivered'|'read'|'failed'} status
 * @param {Date|null} eventAt  Meta's webhook timestamp (preferred). Falls back to now.
 * @param {object} [opts]      { payload } original webhook value, for durable retry
 */
export const applyMetaDeliveryToLimitEvent = async (wamid, status, eventAt = null, opts = {}) => {
  if (!wamid || !["delivered", "read", "failed"].includes(status)) return;

  let affected = 0;
  if (status === "delivered" || status === "read") {
    // FIX 9: stamp delivered_at with Meta's timestamp; COALESCE keeps the FIRST
    // delivery signal (a later `read` must not overwrite `delivered_at`).
    const [, meta] = await db.sequelize.query(
      `UPDATE meta_messaging_limit_events
          SET status = :status,
              delivered_at = COALESCE(delivered_at, :eventAt)
        WHERE wamid = :wamid`,
      {
        replacements: {
          status,
          wamid,
          eventAt: eventAt instanceof Date ? eventAt : new Date(),
        },
      },
    );
    affected = meta?.affectedRows ?? meta?.rowCount ?? 0;
  } else {
    const [count] = await db.MetaMessagingLimitEvents.update(
      { status },
      { where: { wamid } },
    );
    affected = count || 0;
  }

  if (affected === 0 && opts.durable !== false) {
    await persistUnmatchedStatusEvent({ wamid, status, eventAt, payload: opts.payload });
  }
};

/**
 * R-3 hardening: cron entry point. Re-apply unmatched status events whose
 * `next_retry_at` has arrived. Bounded to MAX_UNMATCHED_RETRIES attempts.
 */
export const retryUnmatchedStatusEvents = async () => {
  let due = [];
  try {
    due = await db.sequelize.query(
      `SELECT id, wamid, status, meta_timestamp, retry_count
         FROM meta_unmatched_status_events
        WHERE resolved_at IS NULL
          AND retry_count < :max
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        LIMIT 200`,
      { replacements: { max: MAX_UNMATCHED_RETRIES }, type: db.sequelize.QueryTypes.SELECT },
    );
  } catch (e) {
    logger.warn(`[META-LIMIT] retryUnmatchedStatusEvents list failed: ${e.message}`);
    return;
  }

  for (const row of due) {
    const eventAt = row.meta_timestamp ? new Date(row.meta_timestamp) : null;
    await applyMetaDeliveryToLimitEvent(row.wamid, row.status, eventAt, { durable: false });

    const [check] = await db.sequelize.query(
      `SELECT COUNT(*) c FROM meta_messaging_limit_events WHERE wamid = :w`,
      { replacements: { w: row.wamid }, type: db.sequelize.QueryTypes.SELECT },
    );
    const matched = Number(check?.[0]?.c || check?.c || 0) > 0;

    if (matched) {
      await db.sequelize.query(
        `UPDATE meta_unmatched_status_events SET resolved_at = NOW(), updated_at = NOW() WHERE id = :id`,
        { replacements: { id: row.id } },
      );
    } else {
      const nextIdx = Math.min(row.retry_count + 1, UNMATCHED_RETRY_BACKOFF_MS.length - 1);
      await db.sequelize.query(
        `UPDATE meta_unmatched_status_events
            SET retry_count = retry_count + 1,
                next_retry_at = :next,
                updated_at = NOW()
          WHERE id = :id`,
        { replacements: { id: row.id, next: new Date(Date.now() + UNMATCHED_RETRY_BACKOFF_MS[nextIdx]) } },
      );
      if (row.retry_count + 1 >= MAX_UNMATCHED_RETRIES) {
        logger.warn(`[META-LIMIT] Unmatched status wamid=${row.wamid} exhausted ${MAX_UNMATCHED_RETRIES} retries — giving up`);
      }
    }
  }
};

export const getMetaMessagingLimitUsage = async (wabaId) => {
  if (!wabaId) {
    return { rolling24hUsed: 0, sevenDayUnique: 0, thirtyDayUnique: 0 };
  }

  try {
    const [rows] = await db.sequelize.query(
      `SELECT
         COUNT(DISTINCT CASE WHEN delivered_at >= :dayAgo THEN recipient_phone END) AS rolling_24h,
         COUNT(DISTINCT CASE WHEN delivered_at >= :sevenDaysAgo THEN recipient_phone END) AS seven_days,
         COUNT(DISTINCT CASE WHEN delivered_at >= :thirtyDaysAgo THEN recipient_phone END) AS thirty_days
       FROM meta_messaging_limit_events
       WHERE waba_id = :wabaId
         AND qualifies = true
         AND status IN ('delivered', 'read')`,
      {
        replacements: {
          wabaId,
          dayAgo: new Date(Date.now() - DAY_MS),
          sevenDaysAgo: new Date(Date.now() - 7 * DAY_MS),
          thirtyDaysAgo: new Date(Date.now() - 30 * DAY_MS),
        },
        type: db.sequelize.QueryTypes.SELECT,
      },
    );
    return {
      rolling24hUsed: Number(rows?.rolling_24h || 0),
      sevenDayUnique: Number(rows?.seven_days || 0),
      thirtyDayUnique: Number(rows?.thirty_days || 0),
    };
  } catch (error) {
    logger.warn(`[META-LIMIT] Could not read usage ledger: ${error.message}`);
    return { rolling24hUsed: 0, sevenDayUnique: 0, thirtyDayUnique: 0 };
  }
};
