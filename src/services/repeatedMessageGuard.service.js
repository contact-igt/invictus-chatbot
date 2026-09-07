/**
 * Repeated User Message → AI Handoff guard.
 *
 * Detects five consecutive occurrences of the same normalized inbound user text,
 * durably pauses reactive AI automation for that contact (reusing the existing
 * `contacts.is_ai_silenced` flag), and records one durable handoff event.
 *
 * Every exported check is a no-op (returns the permissive answer) when the
 * feature flag is off for the tenant — so existing behavior is unchanged.
 *
 * The database is the single source of truth. Streak mutation + pause transition
 * happen inside one Sequelize transaction with a `SELECT ... FOR UPDATE` lock on
 * the contact row, so concurrent receipts (same or multiple app instances)
 * produce exactly one pause transition and one handoff event.
 */
import crypto from "crypto";
import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";
import {
  AI_PAUSE_REASONS,
  HANDOFF_EVENT_STATUS,
  REPEATED_MESSAGE_HANDOFF_TEXT,
  REPEATED_MESSAGE_THRESHOLD,
  REPEATED_MESSAGE_WINDOW_MINUTES,
  isRepeatedMessageHandoffEnabled,
} from "../config/repeatedMessageHandoff.config.js";

/**
 * Deterministic normalization for strict equality comparison.
 * NFKC → trim → collapse whitespace → lowercase. Punctuation, digits and emoji
 * are preserved. No fuzzy / semantic / AI matching.
 * @param {string} text
 * @returns {string}
 */
export const normalizeRepeatedMessage = (text = "") =>
  String(text ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

/**
 * SHA-256 (hex) of the already-normalized text. Only the hash is stored.
 * @param {string} normalizedText
 * @returns {string}
 */
export const hashRepeatedMessage = (normalizedText = "") =>
  crypto.createHash("sha256").update(String(normalizedText ?? ""), "utf8").digest("hex");

/**
 * Only non-empty inbound *text* messages count toward the streak. Everything
 * else (interactive replies, buttons, media, location, contacts, system) breaks
 * the current text streak.
 * @param {{ messageType?: string, text?: string }} p
 * @returns {boolean}
 */
export const isQualifyingInboundText = ({ messageType, text } = {}) =>
  messageType === "text" && String(text ?? "").trim().length > 0;

/**
 * Process one accepted, de-duplicated inbound message against the repetition
 * guard. Call this AFTER the distinct WhatsApp message id has been claimed and
 * the message persisted, and BEFORE acquiring the long AI lock.
 *
 * @returns {Promise<{
 *   enabled: boolean,      // feature active for this tenant
 *   paused: boolean,       // contact AI is currently paused (any reason)
 *   justPaused: boolean,   // this exact message caused the pause transition
 *   epoch: number,         // current ai_reply_epoch to use as the fencing token
 *   count?: number,
 *   handoffEventId?: number|null,
 * }>}
 */
export async function processInboundRepeatedMessage({
  tenant_id,
  contact_id,
  messageType,
  text,
  triggerMessageId = null,
}) {
  if (!isRepeatedMessageHandoffEnabled(tenant_id) || !contact_id) {
    return { enabled: false, paused: false, justPaused: false, epoch: 0 };
  }

  return db.sequelize.transaction(async (t) => {
    const [rows] = await db.sequelize.query(
      `SELECT id, is_ai_silenced, ai_pause_reason, ai_reply_epoch,
              repeat_message_hash, repeat_message_count, repeat_last_received_at,
              TIMESTAMPDIFF(SECOND, repeat_last_received_at, NOW()) AS gap_seconds
         FROM ${tableNames.CONTACTS}
        WHERE contact_id = ? AND tenant_id = ?
        LIMIT 1 FOR UPDATE`,
      { replacements: [contact_id, tenant_id], transaction: t },
    );
    const c = rows?.[0];
    if (!c) return { enabled: true, paused: false, justPaused: false, epoch: 0 };

    const epoch = Number(c.ai_reply_epoch || 0);

    // Already paused (manual or repeated) — never increment toward another
    // notice, never enqueue automation. Elapsed time / new messages do not
    // resume AI.
    if (c.is_ai_silenced) {
      return { enabled: true, paused: true, justPaused: false, epoch };
    }

    // Non-qualifying message breaks the streak.
    if (!isQualifyingInboundText({ messageType, text })) {
      if (Number(c.repeat_message_count || 0) > 0 || c.repeat_message_hash) {
        await db.sequelize.query(
          `UPDATE ${tableNames.CONTACTS}
              SET repeat_message_hash = NULL, repeat_message_count = 0, repeat_last_received_at = NULL
            WHERE id = ?`,
          { replacements: [c.id], transaction: t },
        );
      }
      return { enabled: true, paused: false, justPaused: false, epoch };
    }

    const hash = hashRepeatedMessage(normalizeRepeatedMessage(text));
    const now = new Date();
    // Window check is done DB-side (TIMESTAMPDIFF) to avoid any JS/MySQL
    // timezone mismatch on the stored DATETIME.
    const withinWindow =
      c.gap_seconds != null &&
      Number(c.gap_seconds) <= REPEATED_MESSAGE_WINDOW_MINUTES * 60;

    const count =
      c.repeat_message_hash === hash && withinWindow
        ? Number(c.repeat_message_count || 0) + 1
        : 1;

    console.log(
      `[REPEAT-GUARD] tenant=${tenant_id} contact=${contact_id} hashMatch=${c.repeat_message_hash === hash} gap_s=${c.gap_seconds} prevCount=${c.repeat_message_count} -> count=${count}/${REPEATED_MESSAGE_THRESHOLD}`,
    );

    if (count < REPEATED_MESSAGE_THRESHOLD) {
      await db.sequelize.query(
        `UPDATE ${tableNames.CONTACTS}
            SET repeat_message_hash = ?, repeat_message_count = ?, repeat_last_received_at = ?
          WHERE id = ?`,
        { replacements: [hash, count, now, c.id], transaction: t },
      );
      return { enabled: true, paused: false, justPaused: false, epoch, count };
    }

    // Threshold reached → durable pause transition.
    const newEpoch = epoch + 1;
    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACTS}
          SET is_ai_silenced = true,
              ai_pause_reason = ?,
              ai_paused_at = ?,
              ai_reply_epoch = ?,
              repeat_message_hash = ?,
              repeat_message_count = ?,
              repeat_last_received_at = ?
        WHERE id = ?`,
      {
        replacements: [
          AI_PAUSE_REASONS.REPEATED_USER_MESSAGE,
          now,
          newEpoch,
          hash,
          count,
          now,
          c.id,
        ],
        transaction: t,
      },
    );

    // One handoff event per (tenant, contact, epoch). INSERT IGNORE + the unique
    // key guarantees a single row even under concurrent receipts.
    const [insertRes] = await db.sequelize.query(
      `INSERT IGNORE INTO ${tableNames.AI_HANDOFF_EVENTS}
         (tenant_id, contact_id, ai_reply_epoch, trigger_message_id, reason, notice_text, status, attempt_count)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0)`,
      {
        replacements: [
          tenant_id,
          contact_id,
          newEpoch,
          triggerMessageId || null,
          AI_PAUSE_REASONS.REPEATED_USER_MESSAGE,
          REPEATED_MESSAGE_HANDOFF_TEXT,
        ],
        transaction: t,
      },
    );

    return {
      enabled: true,
      paused: true,
      justPaused: true,
      epoch: newEpoch,
      count,
      handoffEventId: insertRes?.insertId || null,
    };
  });
}

/**
 * Fresh eligibility snapshot for a contact, read at the moment an automated
 * conversation job starts. Capture `.epoch` as the fencing token.
 * @returns {Promise<{ enabled: boolean, is_ai_silenced: boolean, epoch: number }>}
 */
export async function getFreshAiEligibility(tenant_id, contact_id) {
  if (!isRepeatedMessageHandoffEnabled(tenant_id) || !contact_id) {
    return { enabled: false, is_ai_silenced: false, epoch: 0 };
  }
  const [rows] = await db.sequelize.query(
    `SELECT is_ai_silenced, ai_reply_epoch FROM ${tableNames.CONTACTS}
      WHERE contact_id = ? AND tenant_id = ? LIMIT 1`,
    { replacements: [contact_id, tenant_id] },
  );
  const c = rows?.[0];
  return {
    enabled: true,
    is_ai_silenced: Boolean(c?.is_ai_silenced),
    epoch: Number(c?.ai_reply_epoch || 0),
  };
}

/**
 * Guard to call as close as possible to every reactive automated send / stale
 * AI-generated side effect. Returns true when the caller must DISCARD its result.
 *
 * No-op (false) when the feature is disabled — so existing sends are untouched.
 * @param {string} tenant_id
 * @param {string} contact_id
 * @param {number|null} startEpoch  epoch captured before slow processing
 * @returns {Promise<boolean>}
 */
export async function shouldDiscardAutomatedReply(tenant_id, contact_id, startEpoch = null) {
  if (!isRepeatedMessageHandoffEnabled(tenant_id) || !contact_id) return false;
  try {
    const { is_ai_silenced, epoch } = await getFreshAiEligibility(tenant_id, contact_id);
    if (is_ai_silenced) return true;
    if (startEpoch != null && Number(epoch) !== Number(startEpoch)) return true;
    return false;
  } catch (err) {
    console.error("[REPEAT-GUARD] eligibility check failed:", err.message);
    return false; // fail-open: never block existing automation on a guard error
  }
}

/**
 * Resume AI for a contact after an explicit staff Unsilence / Resume AI.
 * Atomically clears silence + pause metadata, resets the repetition streak,
 * bumps the epoch, and cancels any still-unsent handoff notice from the
 * previous epoch. Historical `sent` events are never touched.
 *
 * Safe to call even when the feature is disabled (columns exist post-migration).
 * @returns {Promise<{ epoch: number }>}
 */
export async function resumeAiForContact(tenant_id, contact_id) {
  return db.sequelize.transaction(async (t) => {
    const [rows] = await db.sequelize.query(
      `SELECT id, ai_reply_epoch FROM ${tableNames.CONTACTS}
        WHERE contact_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
      { replacements: [contact_id, tenant_id], transaction: t },
    );
    const c = rows?.[0];
    const newEpoch = Number(c?.ai_reply_epoch || 0) + 1;

    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACTS}
          SET is_ai_silenced = false,
              ai_pause_reason = NULL,
              ai_paused_at = NULL,
              repeat_message_hash = NULL,
              repeat_message_count = 0,
              repeat_last_received_at = NULL,
              ai_reply_epoch = ?
        WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [newEpoch, contact_id, tenant_id], transaction: t },
    );

    await db.sequelize.query(
      `UPDATE ${tableNames.AI_HANDOFF_EVENTS}
          SET status = '${HANDOFF_EVENT_STATUS.CANCELLED}'
        WHERE tenant_id = ? AND contact_id = ?
          AND ai_reply_epoch < ?
          AND status IN ('${HANDOFF_EVENT_STATUS.PENDING}', '${HANDOFF_EVENT_STATUS.FAILED}')`,
      { replacements: [tenant_id, contact_id, newEpoch], transaction: t },
    );

    return { epoch: newEpoch };
  });
}

/**
 * Manual Silence AI: mark the reason, timestamp and bump the epoch to fence
 * any in-flight automated work. Does NOT create a handoff notice.
 * Best-effort — never throws (pre-migration safe).
 * @returns {Promise<{ epoch: number|null }>}
 */
export async function markManualPause(tenant_id, contact_id) {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT ai_reply_epoch FROM ${tableNames.CONTACTS}
        WHERE contact_id = ? AND tenant_id = ? LIMIT 1`,
      { replacements: [contact_id, tenant_id] },
    );
    const newEpoch = Number(rows?.[0]?.ai_reply_epoch || 0) + 1;
    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACTS}
          SET ai_pause_reason = '${AI_PAUSE_REASONS.MANUAL}',
              ai_paused_at = NOW(),
              ai_reply_epoch = ?
        WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [newEpoch, contact_id, tenant_id] },
    );
    return { epoch: newEpoch };
  } catch (err) {
    console.error("[REPEAT-GUARD] markManualPause failed:", err.message);
    return { epoch: null };
  }
}
