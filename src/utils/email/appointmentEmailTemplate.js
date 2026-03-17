/**
 * Appointment email templates using Handlebars HTML files from public/html/.
 * Supports: Confirmed, Updated, Cancelled, Completed, Noshow, Pending
 */

import { getTemplate } from "./templateLoader.js";

// Template folder mapping for each status type
const TEMPLATE_FOLDERS = {
  Confirmed: "appointmentConfirmed",
  Updated: "appointmentUpdated",
  Cancelled: "appointmentCancelled",
  Completed: "appointmentCompleted",
  Noshow: "appointmentNoshow",
  Pending: "appointmentPending",
};

/**
 * Generate appointment email HTML from Handlebars template.
 *
 * @param {Object} options
 * @param {"Confirmed"|"Updated"|"Cancelled"|"Completed"|"Noshow"|"Pending"} options.type
 * @param {string} options.patientName
 * @param {string} options.appointmentId
 * @param {number} options.tokenNumber
 * @param {string} options.date - formatted date string (e.g. "15 March 2026")
 * @param {string} options.time
 * @param {string} [options.doctorName]
 * @param {string} [options.reason] - reason for visit / notes
 * @param {string[]} [options.changes] - for "Updated" type, list of what changed
 * @returns {string} HTML string
 */
export const buildAppointmentEmailHtml = ({
  type,
  patientName,
  appointmentId,
  tokenNumber,
  date,
  time,
  doctorName,
  reason,
  changes,
}) => {
  const folderName = TEMPLATE_FOLDERS[type] || TEMPLATE_FOLDERS.Confirmed;
  const template = getTemplate(folderName);

  // Build changes HTML for the Updated template
  let changes_html = "";
  if (type === "Updated" && changes && changes.length > 0) {
    changes_html = changes
      .map((c) => `<p class="change-item">• ${c}</p>`)
      .join("");
  }

  return template({
    patient_name: patientName || "Patient",
    appointment_id: appointmentId || "—",
    token_number: tokenNumber || "—",
    doctor_name: doctorName || "—",
    date: date || "—",
    time: time || "—",
    reason: reason || "—",
    changes_html,
  });
};

/**
 * Generate email subject line for appointment emails.
 */
export const buildAppointmentEmailSubject = ({
  type,
  appointmentId,
  tokenNumber,
  date,
  time,
}) => {
  const subjects = {
    Confirmed: `Appointment Confirmed — Token #${tokenNumber} | ${date} at ${time}`,
    Updated: `Appointment Updated — ${appointmentId} | ${date} at ${time}`,
    Cancelled: `Appointment Cancelled — ${appointmentId}`,
    Completed: `Appointment Completed — ${appointmentId}`,
    Noshow: `Missed Appointment — ${appointmentId}`,
    Pending: `Appointment Pending — Token #${tokenNumber} | ${date} at ${time}`,
  };
  return subjects[type] || `Appointment ${type} — ${appointmentId}`;
};

/**
 * Format a date value to a readable string (e.g. "15 March 2026")
 */
export const formatAppointmentDate = (dateValue) => {
  if (!dateValue) return "—";
  const dt = new Date(dateValue);
  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};
