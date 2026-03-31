import { getDoctorsForAIService } from "../../../models/DoctorModel/doctor.service.js";
import { getRecentAppointmentsForAIService } from "../../../models/AppointmentModel/appointment.service.js";

/**
 * Builds doctor + appointment context for the GENERAL_QUESTION flow.
 * Only fetches what the classifier says is needed (via requires flags).
 *
 * @param {string} tenant_id - Tenant ID
 * @param {string} contact_id - Contact ID (optional, for appointment data)
 * @param {string} tenantTimezone - Tenant timezone string
 * @param {Object} requires - Flags: { doctors: boolean, appointments: boolean }
 * @returns {Promise<{doctorContext: string, appointmentContext: string}>}
 */
export const buildGeneralQuestionContext = async (
  tenant_id,
  contact_id,
  tenantTimezone,
  requires = { doctors: true, appointments: true },
) => {
  let doctorContext = "";
  let appointmentContext = "";

  // Fetch doctor info — only if requires.doctors
  if (requires.doctors) {
    try {
      const doctorsText = await getDoctorsForAIService(tenant_id);
      if (doctorsText) {
        doctorContext = `
═══════════════════════════════
AVAILABLE DOCTORS & SCHEDULES
═══════════════════════════════
The following doctors are registered with this business. Use this data to answer
questions about doctors, their specializations, availability, experience, and qualifications.

${doctorsText}

NOTE: If the customer asks to BOOK an appointment, do NOT proceed with booking.
Instead respond: "I can help you book an appointment! Let me set that up for you."
The booking flow will be handled separately.
`;
      } else {
        doctorContext = `
═══════════════════════════════
DOCTORS
═══════════════════════════════
No doctors are currently configured for this business.
`;
      }
    } catch (err) {
      console.error("[GENERAL-CONTEXT] Failed to fetch doctors:", err.message);
    }
  }

  // Fetch appointment data — only if requires.appointments AND contact_id exists
  if (requires.appointments && contact_id) {
    try {
      const appointments = await getRecentAppointmentsForAIService(
        tenant_id,
        contact_id,
      );
      if (appointments && appointments.length > 0) {
        appointmentContext = `
═══════════════════════════════
CUSTOMER'S APPOINTMENTS
═══════════════════════════════
Use this data to answer questions about the customer's appointments.
Do NOT make up appointment details — only reference what is listed below.

${formatAppointmentsForContext(appointments, tenantTimezone)}

NOTE: If the customer wants to BOOK, RESCHEDULE, or CANCEL an appointment,
do NOT take action. Instead respond that you'll help them with that.
The appointment action flow will be handled separately.
`;
      } else {
        appointmentContext = `
═══════════════════════════════
CUSTOMER'S APPOINTMENTS
═══════════════════════════════
This customer has no recent appointments.
`;
      }
    } catch (err) {
      console.error(
        "[GENERAL-CONTEXT] Failed to fetch appointments:",
        err.message,
      );
    }
  }

  return { doctorContext, appointmentContext };
};

/**
 * Formats appointment records into a readable text block for the AI.
 *
 * Groups appointments into categories:
 * - Upcoming (future, active)
 * - Completed
 * - Cancelled/Deleted
 *
 * @param {Array} appointments - Sequelize appointment records with doctor include
 * @param {string} timezone - Tenant timezone
 * @returns {string} Formatted text
 */
const formatAppointmentsForContext = (appointments, timezone) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const upcoming = [];
  const completed = [];
  const cancelled = [];
  const expired = [];

  for (const appt of appointments) {
    const apptDate = new Date(appt.appointment_date);
    const doctorName = appt.doctor
      ? `${appt.doctor.title || ""} ${appt.doctor.name}`.trim()
      : "No doctor assigned";
    const doctorId = appt.doctor?.doctor_id || "N/A";

    const line =
      `- Appointment ${appt.appointment_id}` +
      (appt.token_number ? ` (Token: #${appt.token_number})` : "") +
      ` on ${formatDate(appt.appointment_date)}` +
      ` at ${appt.appointment_time}` +
      ` with ${doctorName} (${doctorId})` +
      ` [Status: ${appt.status}]` +
      (appt.notes ? ` | Notes: ${appt.notes}` : "");

    if (appt.is_deleted || appt.status === "Cancelled") {
      cancelled.push(line);
    } else if (appt.status === "Completed") {
      completed.push(line);
    } else if (apptDate < today) {
      expired.push(line + " — EXPIRED");
    } else {
      upcoming.push(line);
    }
  }

  let text = "";

  if (upcoming.length > 0) {
    text += `UPCOMING APPOINTMENTS:\n${upcoming.join("\n")}\n\n`;
  }

  if (expired.length > 0) {
    text += `EXPIRED APPOINTMENTS (date has passed):\n${expired.join("\n")}\n\n`;
  }

  if (completed.length > 0) {
    text += `COMPLETED APPOINTMENTS:\n${completed.join("\n")}\n\n`;
  }

  if (cancelled.length > 0) {
    text += `RECENTLY CANCELLED:\n${cancelled.join("\n")}\n\n`;
  }

  if (!text) {
    text = "No appointments found.\n";
  }

  return text.trim();
};

/**
 * Formats a date to "DD Mon YYYY" format.
 * @param {string|Date} date
 * @returns {string}
 */
const formatDate = (date) => {
  const d = new Date(date);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};
