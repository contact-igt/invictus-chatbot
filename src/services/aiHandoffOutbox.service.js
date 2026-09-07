/**
 * Durable delivery of the repeated-message handoff notice.
 *
 * The notice is NOT an AI response: it does not call any AI model and does not
 * require AI wallet eligibility. It is sent with the normal WhatsApp text
 * transport and persisted / emitted like any other bot message.
 *
 * Delivery is idempotent-ish and multi-instance safe: an event is claimed with
 * a conditional UPDATE (pending → sending) so only one instance sends it. The
 * AI pause stays active regardless of whether the notice send succeeds.
 */
import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";
import {
  HANDOFF_EVENT_STATUS,
  HANDOFF_MAX_ATTEMPTS,
} from "../config/repeatedMessageHandoff.config.js";
import { sendWhatsAppMessage } from "../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../models/Messages/messages.service.js";
import { getIO } from "../middlewares/socket/socket.js";

const setStatus = (id, fields) => {
  const keys = Object.keys(fields);
  return db.sequelize.query(
    `UPDATE ${tableNames.AI_HANDOFF_EVENTS}
        SET ${keys.map((k) => `${k} = ?`).join(", ")}
      WHERE id = ?`,
    { replacements: [...keys.map((k) => fields[k]), id] },
  );
};

/**
 * Claim and send one handoff event by id. Verifies the contact is still paused
 * for this exact epoch before sending (a resume may have cancelled it).
 * @param {number} eventId
 */
export async function dispatchHandoffEvent(eventId) {
  if (!eventId) return;

  // Atomic claim — only the instance that flips pending→sending proceeds.
  const [, claimMeta] = await db.sequelize.query(
    `UPDATE ${tableNames.AI_HANDOFF_EVENTS}
        SET status = '${HANDOFF_EVENT_STATUS.SENDING}',
            attempt_count = attempt_count + 1,
            last_attempt_at = NOW()
      WHERE id = ?
        AND status IN ('${HANDOFF_EVENT_STATUS.PENDING}', '${HANDOFF_EVENT_STATUS.FAILED}')`,
    { replacements: [eventId] },
  );
  if ((claimMeta?.affectedRows ?? claimMeta) !== 1) return; // someone else has it / not sendable

  const [rows] = await db.sequelize.query(
    `SELECT e.id, e.tenant_id, e.contact_id, e.notice_text, e.attempt_count,
            e.ai_reply_epoch AS event_epoch,
            c.is_ai_silenced, c.ai_reply_epoch AS contact_epoch, c.phone, c.name
       FROM ${tableNames.AI_HANDOFF_EVENTS} e
       JOIN ${tableNames.CONTACTS} c
         ON c.contact_id = e.contact_id AND c.tenant_id = e.tenant_id
      WHERE e.id = ? LIMIT 1`,
    { replacements: [eventId] },
  );
  const ev = rows?.[0];
  if (!ev) {
    await setStatus(eventId, { status: HANDOFF_EVENT_STATUS.FAILED });
    return;
  }

  // The pause this notice belongs to must still be the current one. If staff
  // resumed AI (or a newer pause epoch exists), cancel this stale notice.
  if (!ev.is_ai_silenced || Number(ev.contact_epoch) !== Number(ev.event_epoch)) {
    await setStatus(eventId, { status: HANDOFF_EVENT_STATUS.CANCELLED });
    return;
  }

  try {
    const sendRes = await sendWhatsAppMessage(ev.tenant_id, ev.phone, ev.notice_text);
    const wamid = sendRes?.wamid || null;

    await setStatus(eventId, {
      status: HANDOFF_EVENT_STATUS.SENT,
      provider_message_id: wamid,
    });

    try {
      const saved = await createUserMessageService(
        ev.tenant_id,
        ev.contact_id,
        sendRes?.phone_number_id || null,
        ev.phone,
        wamid,
        ev.name,
        "bot",
        null,
        ev.notice_text,
        "text",
        null,
        null,
        wamid ? "sent" : null,
      );
      const io = getIO();
      io?.to(`tenant-${ev.tenant_id}`).emit("ai-typing", {
        tenant_id: ev.tenant_id,
        phone: ev.phone,
        status: false,
      });
      io?.to(`tenant-${ev.tenant_id}`).emit("new-message", {
        tenant_id: ev.tenant_id,
        phone: ev.phone,
        id: saved?.id,
        contact_id: ev.contact_id,
        phone_number_id: sendRes?.phone_number_id || null,
        name: ev.name,
        message: ev.notice_text,
        message_type: "text",
        media_url: null,
        status: "sent",
        sender: "bot",
        created_at: new Date(),
      });
    } catch (persistErr) {
      console.error("[HANDOFF-OUTBOX] notice persist/emit failed:", persistErr.message);
    }
  } catch (sendErr) {
    // A timeout after Meta may have accepted the message → unknown, do not
    // blindly retry. Other errors → bounded retry.
    const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED/i.test(sendErr.message || "");
    const attempts = Number(ev.attempt_count || 0) + 1;
    const nextStatus = isTimeout
      ? HANDOFF_EVENT_STATUS.UNKNOWN
      : attempts >= HANDOFF_MAX_ATTEMPTS
        ? HANDOFF_EVENT_STATUS.UNKNOWN
        : HANDOFF_EVENT_STATUS.FAILED;
    await setStatus(eventId, { status: nextStatus });
    console.error(`[HANDOFF-OUTBOX] send failed (event ${eventId} → ${nextStatus}):`, sendErr.message);
  }
}

/**
 * Dispatch the pending handoff notice for a specific pause (tenant/contact/epoch).
 * Used right after a pause transition; falls back to the recovery cron otherwise.
 */
export async function dispatchHandoffForPause(tenant_id, contact_id, epoch) {
  const [rows] = await db.sequelize.query(
    `SELECT id FROM ${tableNames.AI_HANDOFF_EVENTS}
      WHERE tenant_id = ? AND contact_id = ? AND ai_reply_epoch = ?
        AND status = '${HANDOFF_EVENT_STATUS.PENDING}'
      LIMIT 1`,
    { replacements: [tenant_id, contact_id, epoch] },
  );
  if (rows?.[0]?.id) await dispatchHandoffEvent(rows[0].id);
}

/**
 * Startup / periodic recovery. Picks up handoff events that were never sent
 * (crash between pause commit and dispatch, or a bounded retry).
 */
export async function recoverPendingHandoffEvents() {
  const [rows] = await db.sequelize.query(
    `SELECT id FROM ${tableNames.AI_HANDOFF_EVENTS}
      WHERE status IN ('${HANDOFF_EVENT_STATUS.PENDING}', '${HANDOFF_EVENT_STATUS.FAILED}')
        AND attempt_count < ?
        AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL 2 MINUTE)
      ORDER BY id ASC
      LIMIT 25`,
    { replacements: [HANDOFF_MAX_ATTEMPTS] },
  );
  for (const r of rows || []) {
    await dispatchHandoffEvent(r.id).catch((err) =>
      console.error(`[HANDOFF-OUTBOX] recovery dispatch ${r.id} failed:`, err.message),
    );
  }
}
