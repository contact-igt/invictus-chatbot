import axios from "axios";
import https from "https";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { getSecret } from "../TenantSecretsModel/tenantSecrets.service.js";
import { encodeSlotTime } from "./appointmentReplyDecoder.js";

const httpsAgent = new https.Agent({ family: 4, keepAlive: true });

const truncate = (value, max) => String(value || "").slice(0, max);
const MAX_LIST_ROWS = 10;

const getWhatsAppCredentials = async (tenant_id) => {
  const [rows] = await db.sequelize.query(
    `SELECT phone_number_id
     FROM ${tableNames.WHATSAPP_ACCOUNT}
     WHERE tenant_id = ? AND status IN ('active', 'verified')
     LIMIT 1`,
    { replacements: [tenant_id] },
  );
  if (!rows.length) throw new Error("No active WhatsApp account for tenant");

  const access_token = await getSecret(tenant_id, "whatsapp");
  if (!access_token) throw new Error("WhatsApp access token not found");

  return {
    phone_number_id: rows[0].phone_number_id,
    access_token,
  };
};

export const sendAppointmentPayload = async (tenant_id, payload) => {
  const { phone_number_id, access_token } = await getWhatsAppCredentials(tenant_id);
  const version = process.env.META_API_VERSION || "v23.0";
  try {
    const response = await axios.post(
      `https://graph.facebook.com/${version}/${phone_number_id}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        httpsAgent,
      },
    );

    const wamid = response.data?.messages?.[0]?.id || null;
    if (!wamid) {
      throw new Error("WhatsApp send did not return a message id");
    }
    return wamid;
  } catch (axiosErr) {
    if (axiosErr.response) {
      console.error(
        "[ADV-APPT-WA] Meta API error:",
        JSON.stringify(axiosErr.response.data, null, 2),
      );
      const metaErr = axiosErr.response.data?.error || {};
      const metaMsg = metaErr.message || axiosErr.message;
      const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
      const subcode = metaErr.error_subcode
        ? ` (Subcode: ${metaErr.error_subcode})`
        : "";

      if (metaErr.code === 190 || metaErr.type === "OAuthException") {
        const tokenErr = new Error(
          `Meta Access Token Error: ${metaMsg}${code}${subcode}`,
        );
        tokenErr.isTokenError = true;
        throw tokenErr;
      }

      throw new Error(`Meta API Error: ${metaMsg}${code}${subcode}`);
    }
    throw axiosErr;
  }
};

export const buildTextPayload = (to, text) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "text",
  text: {
    preview_url: false,
    body: truncate(text, 4096),
  },
});

const buildButtonPayload = (to, text, buttons) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: truncate(text, 1024) },
    action: {
      buttons: buttons.slice(0, 3).map((button) => ({
        type: "reply",
        reply: {
          id: truncate(button.id, 256),
          title: truncate(button.title, 20),
        },
      })),
    },
  },
});

export const buildTextOptionsPayload = (to, text, buttons) =>
  buildButtonPayload(to, text, buttons);

const buildListPayload = (to, text, buttonLabel, sections) => {
  let count = 0;
  const safeSections = sections
    .map((section) => ({
      title: truncate(section.title, 24),
      rows: (section.rows || [])
        .filter(() => {
          if (count >= MAX_LIST_ROWS) return false;
          count += 1;
          return true;
        })
        .map((row) => ({
          id: truncate(row.id, 200),
          title: truncate(row.title, 24),
          description: truncate(row.description, 72),
        })),
    }))
    .filter((section) => section.rows.length);

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: truncate(text, 1024) },
      action: {
        button: truncate(buttonLabel, 20),
        sections: safeSections,
      },
    },
  };
};

export const buildDoctorListPayload = (to, doctors) => {
  const rows = doctors.map((doctor) => ({
    id: `doctor_${doctor.doctor_id}`,
    title: `Dr. ${doctor.name}`,
    description:
      (doctor.specializations || []).map((s) => s.name).join(", ") ||
      doctor.qualification ||
      "Available",
  }));

  return buildListPayload(
    to,
    "Please choose a doctor for your appointment.",
    "View doctors",
    [{ title: "Available doctors", rows }],
  );
};

export const buildDateListPayload = (to, dates) => {
  const rows = dates.map((date) => ({
    id: `date_${date.value}`,
    title: date.label,
    description: date.description || "Available",
  }));

  return buildListPayload(
    to,
    "Please choose an appointment date.",
    "Pick date",
    [{ title: "Available dates", rows }],
  );
};

export const buildTimeSlotPayload = (to, slots, options = {}) => {
  const rows = slots.map((slot) => ({
    id: slot.id || `slot_${encodeSlotTime(slot.time || slot)}`,
    title: slot.title || slot.time || slot,
    description: slot.description || "Available",
  }));

  return buildListPayload(
    to,
    options.bodyText || "Please choose an available time slot.",
    "Pick time",
    [{ title: options.sectionTitle || "Available Time Slots", rows }],
  );
};

export const buildReasonServiceListPayload = (
  to,
  services,
  bodyText = "Please select our services for visit from the list, or type reason for Visit.",
) => {
  const rows = services.map((service) => ({
    id: `reason_${service.specialization_id || service.id}`,
    title: service.name,
    description: service.description || "Reason for visit",
  }));

  const payload = buildListPayload(
    to,
    bodyText,
    "Select Services",
    [{ title: "Services", rows }],
  );

  payload.interactive.header = {
    type: "text",
    text: "Select Our Services / Reason for Visit",
  };

  return payload;
};

export const buildConfirmPayload = (to, draft) => {
  const text =
    `Please confirm your appointment booking.\n\n` +
    `Name: ${draft.name || "-"}\n` +
    `Email: ${draft.email || "-"}\n` +
    `Doctor: ${draft.doctorName ? `Dr. ${draft.doctorName}` : "-"}\n` +
    `Date: ${draft.date || "-"}\n` +
    `Time: ${draft.time || "-"}\n` +
    `Reason: ${draft.reason || "-"}`;

  return buildButtonPayload(to, text, [
    { id: "confirm_booking", title: "Confirm" },
    { id: "edit_details", title: "Edit" },
    { id: "cancel_booking", title: "Cancel" },
  ]);
};

export const buildEditMenuPayload = (to, editableFields) =>
  buildListPayload(
    to,
    "Need to change any details? Click Edit to select what to edit.",
    "Edit",
    [
      {
        title: "Appointment details",
        rows: editableFields,
      },
    ],
  );

export const buildSuccessPayload = (to, appointment) =>
  buildTextPayload(
    to,
    `Your appointment request has been submitted successfully.\n\n` +
      `Our team will review your request shortly. You will receive a confirmation email once it is approved.\n\n` +
      `Appointment ID: ${appointment.appointment_id || "-"}\n` +
      `Token: #${appointment.token_number || "-"}\n` +
      `Date: ${appointment.appointment_date || "-"}\n` +
      `Time: ${appointment.appointment_time || "-"}`,
  );

export const buildQuitPayload = (to) =>
  buildButtonPayload(to, "Do you want to cancel this appointment booking?", [
    { id: "cancel_appointment", title: "Yes, Cancel" },
    { id: "continue_appointment", title: "No, Continue" },
  ]);

export const buildAppointmentResumeCancelPayload = (to) =>
  buildButtonPayload(
    to,
    "You are currently in the middle of booking an appointment.\n\nWould you like to continue your appointment booking or cancel it?",
    [
      { id: "continue_appointment", title: "Continue" },
      { id: "cancel_appointment", title: "Cancel" },
    ],
  );
