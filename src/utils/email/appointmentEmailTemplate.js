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
 * @param {string} options.date - formatted date string (e.g. "15 Mar 2026")
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
  companyName,
  companyPhone,
  companyWebsite,
}) => {
  const folderName = TEMPLATE_FOLDERS[type] || TEMPLATE_FOLDERS.Confirmed;
  const template = getTemplate(folderName);

  // Build changes HTML for the Updated template
  let changes_html = "";
  if (type === "Updated" && changes && changes.length > 0) {
    changes_html = changes
      .map((c) => `<p class="change-item">- ${c}</p>`)
      .join("");
  }

  return template({
    patient_name: patientName || "Patient",
    appointment_id: appointmentId || "-",
    token_number: tokenNumber || "-",
    doctor_name: doctorName || "Your doctor",
    date: date || "-",
    time: time || "-",
    reason: reason || "-",
    changes_html,
    company_name: companyName || "WhatsNexus",
    company_phone: companyPhone || "",
    company_website: companyWebsite || "",
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
    Confirmed: "Your Appointment is Confirmed ✅",
    Updated: `Appointment Updated — ${appointmentId} | ${date} at ${time}`,
    Cancelled: "Your Appointment Has Been Cancelled ❌",
    Completed: `Appointment Completed — ${appointmentId}`,
    Noshow: `Missed Appointment — ${appointmentId}`,
    Pending: `Appointment Pending — Token #${tokenNumber} | ${date} at ${time}`,
  };
  return subjects[type] || `Appointment ${type} — ${appointmentId}`;
};

/**
 * Format a date value to a readable string (e.g. "20 May 2026").
 * Noon anchor prevents timezone rollover for DATE-only strings.
 */
export const formatAppointmentDate = (dateValue) => {
  if (!dateValue) return "TBD";

  const dateStr =
    typeof dateValue === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(dateValue.trim())
      ? `${dateValue.trim()}T12:00:00`
      : dateValue;

  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return "TBD";

  return dt.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};
