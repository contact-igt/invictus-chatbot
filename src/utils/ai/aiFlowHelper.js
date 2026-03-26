import db from "../../database/index.js";
import { searchKnowledgeChunks } from "../../models/Knowledge/knowledge.search.js";
import { getActivePromptService } from "../../models/AiPrompt/aiprompt.service.js";
import {
  getCommonBasePrompt,
  getLeadSourcePrompt,
  getAppointmentBookingPrompt,
  DEFAULT_SYSTEM_PROMPT,
} from "./prompts/index.js";
import { getLeadByContactIdService } from "../../models/LeadsModel/leads.service.js";
import { getDoctorsForAIService } from "../../models/DoctorModel/doctor.service.js";
import { getRecentAppointmentsForAIService } from "../../models/AppointmentModel/appointment.service.js";
import { getTenantSettingsService } from "../../models/TenantModel/tenant.service.js";

/**
 * Shared utility to build the complete System Prompt for the AI flow.
 * Used by both production WhatsApp chat and Playground.
 * @param {Object} cachedData - Optional pre-fetched data to avoid redundant DB calls
 * @param {Object} cachedData.tenantSettings - Tenant settings (timezone, company_name, etc.)
 * @param {Object} cachedData.contact - Contact object (name, email, phone)
 * @param {Object} cachedData.lead - Lead object (source, etc.)
 */
export const buildAiSystemPrompt = async (
  tenant_id,
  contact_id,
  languageInfo,
  userMessage,
  cachedData = {},
) => {
  // Use cached tenant settings or fetch if not provided
  let businessName = "our clinic";
  let tenantTimezone = "Asia/Kolkata"; // Default for backward compatibility
  try {
    const tenantSettings =
      cachedData.tenantSettings || (await getTenantSettingsService(tenant_id));
    if (tenantSettings?.company_name)
      businessName = tenantSettings.company_name;
    if (tenantSettings?.timezone) tenantTimezone = tenantSettings.timezone;
  } catch (_) {}

  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: tenantTimezone }),
  );

  const currentDateFormatted = now.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const currentDayFormatted = now.toLocaleDateString("en-US", {
    weekday: "long",
  });

  const currentTimeFormatted = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  // 1. Fetch Prompts & Knowledge
  const hospitalPrompt =
    (await getActivePromptService(tenant_id)) || DEFAULT_SYSTEM_PROMPT;

  const commonBasePrompt = getCommonBasePrompt(languageInfo, businessName);

  const { chunks, resolvedLogs, sources } = await searchKnowledgeChunks(
    tenant_id,
    userMessage,
  );

  const knowledgeContext =
    chunks && chunks.length > 0
      ? chunks.join("\n\n")
      : "No relevant uploaded documents.";
  const resolvedContext =
    resolvedLogs && resolvedLogs.length > 0 ? resolvedLogs.join("\n\n") : "";

  const combinedKnowledge = `
${knowledgeContext}

${
  resolvedContext
    ? `
────────────────────────────────
RESOLVED PAST QUESTIONS (HIGH PRIORITY)
────────────────────────────────
Use these past resolutions to answer if the user's question matches:

${resolvedContext}
`
    : ""
}
`;

  // 2. Patient & Lead Source Context
  let patientProfileSection = "";
  let leadSourcePrompt = "";

  if (contact_id) {
    try {
      // Use cached contact or fetch if not provided
      const contact =
        cachedData.contact ||
        (await db.Contacts.findOne({
          where: { contact_id, tenant_id },
          attributes: ["name", "email", "phone"],
        }));
      if (contact) {
        const emailStatus = contact.email
          ? `${contact.email} (on file)`
          : "NOT PROVIDED — MUST ASK";
        patientProfileSection = `PATIENT PROFILE:\n- Name: ${contact.name || "Unknown — MUST ASK"}\n- Email: ${emailStatus}\n- Phone: ${contact.phone || "Known"}`;
      }

      // Use cached lead or fetch if not provided
      const lead =
        cachedData.lead ||
        (await getLeadByContactIdService(tenant_id, contact_id));
      if (lead && lead.source === "none") {
        leadSourcePrompt = getLeadSourcePrompt(contact_id);
      }
    } catch (err) {
      console.error("[AI-FLOW-HELPER] Context error:", err.message);
    }
  }

  // 3. Appointment & Doctor Context
  let appointmentBookingPrompt = "";
  try {
    const doctorsList = await getDoctorsForAIService(tenant_id);
    const doctorsSection = doctorsList
      ? `AVAILABLE DOCTORS:\n${doctorsList}`
      : "No doctors are currently available for booking.";

    let existingAppointmentsSection = "";
    if (contact_id) {
      const recentAppts = await getRecentAppointmentsForAIService(
        tenant_id,
        contact_id,
      );
      if (recentAppts && recentAppts.length > 0) {
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

        const futureAppts = recentAppts.filter(
          (a) =>
            !a.is_deleted &&
            a.status !== "Cancelled" &&
            a.appointment_date >= todayStr,
        );
        const pastAppts = recentAppts.filter(
          (a) =>
            !a.is_deleted &&
            a.status !== "Cancelled" &&
            a.appointment_date < todayStr,
        );
        const cancelledAppts = recentAppts.filter(
          (a) => a.is_deleted || a.status === "Cancelled",
        );

        let activeText = "";
        if (futureAppts.length > 0) {
          activeText =
            "\nUPCOMING ACTIVE APPOINTMENTS (SOURCE OF TRUTH):\n" +
            futureAppts
              .map((a) => {
                const dateStr = new Date(a.appointment_date).toLocaleDateString(
                  "en-GB",
                  { day: "2-digit", month: "long", year: "numeric" },
                );
                return `  - Appointment ${a.appointment_id} (Token: ${a.token_number}) on ${dateStr} at ${a.appointment_time} with ${a.doctor?.name || "Unknown Doctor"} [Status: ${a.status}]`;
              })
              .join("\n") +
            "\n";
        }

        let pastText = "";
        if (pastAppts.length > 0) {
          pastText =
            "\nPAST APPOINTMENTS (HISTORY):\n" +
            pastAppts
              .map((a) => {
                const dateStr = new Date(a.appointment_date).toLocaleDateString(
                  "en-GB",
                  { day: "2-digit", month: "long", year: "numeric" },
                );
                return `  - Appointment ${a.appointment_id} on ${dateStr} at ${a.appointment_time} [Status: ${a.status}]`;
              })
              .join("\n") +
            "\n";
        }

        let cancelledText = "";
        if (cancelledAppts.length > 0) {
          cancelledText =
            "\nRECENTLY CANCELLED/DELETED APPOINTMENTS (PAST 24H):\n" +
            cancelledAppts
              .map((a) => {
                const dateStr = new Date(a.appointment_date).toLocaleDateString(
                  "en-GB",
                  { day: "2-digit", month: "long", year: "numeric" },
                );
                return `  - Appointment ${a.appointment_id} on ${dateStr} was CANCELLED or DELETED.`;
              })
              .join("\n") +
            "\n";
        }
        existingAppointmentsSection = activeText + pastText + cancelledText;
      }
    }
    appointmentBookingPrompt = getAppointmentBookingPrompt(
      doctorsSection,
      existingAppointmentsSection,
      patientProfileSection,
    );
  } catch (err) {
    console.error("[AI-FLOW-HELPER] Appointment prompt error:", err.message);
  }

  const systemPrompt = `
STRICT SOURCE OF TRUTH MANDATE:
- Use ONLY the "UPCOMING ACTIVE APPOINTMENTS" section to verify if a user has a valid appointment.
- If an appointment ID is NOT in the lists below, it does NOT exist. Do NOT assume, estimate, or hallucinate status.
- If an appointment is in "PAST APPOINTMENTS", it has already happened; do not try to cancel or update it unless explicitly requested for a reschedule.
- If a doctor is listed with status 'busy' or 'off duty', they are currently unavailable for new bookings.

${leadSourcePrompt}

${appointmentBookingPrompt}

${commonBasePrompt}

${hospitalPrompt}

CURRENT DATE & DAY & TIME (IST):
Date: ${currentDateFormatted}
Day: ${currentDayFormatted}
Time: ${currentTimeFormatted}

UPLOADED KNOWLEDGE:
${combinedKnowledge}
`;

  return {
    systemPrompt,
    knowledgeSources: sources,
    chunks,
    resolvedContext,
  };
};
