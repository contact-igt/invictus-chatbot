import axios from "axios";
import https from "https";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

const httpsAgent = new https.Agent({ family: 4, keepAlive: true });

// ─── Internal: fetch WhatsApp credentials for a tenant ───────────────────────
const getWhatsAppCredentials = async (tenant_id) => {
  const [rows] = await db.sequelize.query(
    `SELECT phone_number_id, access_token
     FROM ${tableNames.WHATSAPP_ACCOUNT}
     WHERE tenant_id = ? AND status IN ('active', 'verified')
     LIMIT 1`,
    { replacements: [tenant_id] },
  );
  if (!rows.length) throw new Error("No active WhatsApp account for tenant");
  return rows[0];
};

// ─── Internal: POST any payload to the Meta messages endpoint ─────────────────
const postToMeta = async (tenant_id, payload) => {
  const { phone_number_id, access_token } = await getWhatsAppCredentials(tenant_id);
  const META_API_VERSION = process.env.META_API_VERSION || "v23.0";
  try {
    const response = await axios.post(
      `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        httpsAgent,
      },
    );
    return response.data?.messages?.[0]?.id || null;
  } catch (err) {
    if (err.response) {
      const metaErr = err.response.data?.error || {};
      const msg = metaErr.message || err.message;
      const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
      console.error("[WA-BUTTONS] Meta API error:", JSON.stringify(err.response.data));
      throw new Error(`Meta API Error: ${msg}${code}`);
    }
    throw err;
  }
};

// ─── 3A. Send Quick Reply (max 3 buttons) ─────────────────────────────────────
/**
 * @param {string} tenant_id
 * @param {string} to  - recipient phone number
 * @param {string} bodyText
 * @param {Array<{id: string, title: string}>} buttons - max 3
 */
export const sendQuickReply = async (tenant_id, to, bodyText, buttons) => {
  if (!buttons || buttons.length === 0) {
    console.warn("[WA-BUTTONS] sendQuickReply called with empty buttons array");
    return null;
  }
  // Meta enforces max 3 buttons and max 20 chars per title
  const safeButtons = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: {
      id: String(b.id).slice(0, 256),
      title: String(b.title).slice(0, 20),
    },
  }));

  return postToMeta(tenant_id, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: String(bodyText).slice(0, 1024) },
      action: { buttons: safeButtons },
    },
  });
};

// ─── 3B. Send List Message (max 10 rows total) ────────────────────────────────
/**
 * @param {string} tenant_id
 * @param {string} to
 * @param {string} bodyText
 * @param {string} buttonLabel  - label shown on the list-open button
 * @param {Array<{title: string, rows: Array<{id, title, description}>}>} sections
 */
export const sendListMessage = async (
  tenant_id,
  to,
  bodyText,
  buttonLabel,
  sections,
) => {
  // Enforce max 10 rows across all sections
  let rowCount = 0;
  const safeSections = sections.map((section) => ({
    title: String(section.title || "").slice(0, 24),
    rows: section.rows
      .filter(() => {
        if (rowCount >= 10) return false;
        rowCount++;
        return true;
      })
      .map((r) => ({
        id: String(r.id).slice(0, 200),
        title: String(r.title).slice(0, 24),
        description: String(r.description || "").slice(0, 72),
      })),
  }));

  return postToMeta(tenant_id, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: String(bodyText).slice(0, 1024) },
      action: {
        button: String(buttonLabel || "View options").slice(0, 20),
        sections: safeSections,
      },
    },
  });
};

// ─── 3C. Send Appointment Card ────────────────────────────────────────────────
/**
 * Sends a formatted appointment summary with Reschedule + Cancel buttons.
 *
 * @param {string} tenant_id
 * @param {string} to
 * @param {object} appointment  - { id, appointment_id, doctor_name, date,
 *                                  appointment_time, token_number, status }
 */
export const sendAppointmentCard = async (tenant_id, to, appointment) => {
  const aptId = appointment.appointment_id || appointment.id || "unknown";
  const doctorLine = appointment.doctor_name
    ? `*Doctor:* Dr. ${appointment.doctor_name}`
    : "*Doctor:* Not assigned";

  const dateStr = appointment.appointment_date
    ? new Date(appointment.appointment_date).toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : appointment.date || "—";

  const bodyText =
    `📋 *Appointment Details*\n\n` +
    `${doctorLine}\n` +
    `*Date:* ${dateStr}\n` +
    `*Time:* ${appointment.appointment_time || appointment.time || "—"}\n` +
    `*Token:* #${appointment.token_number || "—"}\n` +
    `*Status:* ${appointment.status || "—"}`;

  return sendQuickReply(tenant_id, to, bodyText, [
    { id: `reschedule_${aptId}`, title: "Reschedule" },
    { id: `cancel_${aptId}`, title: "Cancel" },
  ]);
};

// ─── 3D. Parse Button / List Reply from Incoming Webhook ──────────────────────
/**
 * Extracts the reply id from an incoming WhatsApp interactive message.
 * Returns null if the message is not a button/list reply.
 *
 * @param {object} message  - the message object from Meta's webhook payload
 * @returns {string|null}
 */
export const parseButtonReply = (message) => {
  try {
    if (!message || message.type !== "interactive") return null;

    const interactive = message.interactive;
    if (!interactive) return null;

    if (interactive.type === "button_reply") {
      return interactive.button_reply?.id || null;
    }
    if (interactive.type === "list_reply") {
      return interactive.list_reply?.id || null;
    }
    return null;
  } catch {
    return null;
  }
};
