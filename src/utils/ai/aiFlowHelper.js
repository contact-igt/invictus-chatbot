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
import {
  getCurrentDateTimeForAI,
  getCalendarReferenceForAI,
  DEFAULT_TIMEZONE,
} from "../helpers/timezone.js";

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
  let tenantTimezone = DEFAULT_TIMEZONE; // Default for backward compatibility
  try {
    const tenantSettings =
      cachedData.tenantSettings || (await getTenantSettingsService(tenant_id));
    if (tenantSettings?.company_name)
      businessName = tenantSettings.company_name;
    // Check ai_settings.timezone first, then fallback to tenantSettings.timezone
    if (tenantSettings?.ai_settings?.timezone) {
      tenantTimezone = tenantSettings.ai_settings.timezone;
    } else if (tenantSettings?.timezone) {
      tenantTimezone = tenantSettings.timezone;
    }
  } catch (_) {}

  // Use timezone helper for consistent date/time formatting
  const dateTimeInfo = getCurrentDateTimeForAI(tenantTimezone);
  const calendarReference = getCalendarReferenceForAI(tenantTimezone);

  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: tenantTimezone }),
  );

  const currentDateFormatted = dateTimeInfo.date;
  const currentDayFormatted = dateTimeInfo.day;
  const currentTimeFormatted = dateTimeInfo.time;

  // 1. Fetch Prompts & Knowledge
  let hospitalPrompt = DEFAULT_SYSTEM_PROMPT;
  try {
    hospitalPrompt =
      (await getActivePromptService(tenant_id)) || DEFAULT_SYSTEM_PROMPT;
  } catch (promptErr) {
    console.error(
      "[AI-FLOW-HELPER] Active prompt fetch failed:",
      promptErr.message,
    );
  }

  const commonBasePrompt = getCommonBasePrompt(languageInfo, businessName);

  let chunks = [];
  let resolvedLogs = [];
  let sources = [];
  try {
    const searchResult = await searchKnowledgeChunks(tenant_id, userMessage);
    chunks = searchResult.chunks || [];
    resolvedLogs = searchResult.resolvedLogs || [];
    sources = searchResult.sources || [];
  } catch (knErr) {
    console.error("[AI-FLOW-HELPER] Knowledge search failed:", knErr.message);
  }

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
      : "⚠️ NO DOCTORS CONFIGURED ⚠️\nNo doctors are currently available for booking. The clinic has not added any doctors to the system yet. DO NOT attempt to book appointments or show any doctor list. Inform user that booking is not available and offer to connect them with the team.";

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
            a.status !== "Completed" &&
            a.appointment_date >= todayStr,
        );
        const expiredConfirmedAppts = recentAppts.filter(
          (a) =>
            !a.is_deleted &&
            a.status !== "Cancelled" &&
            a.status !== "Completed" &&
            a.appointment_date < todayStr,
        );
        const completedAppts = recentAppts.filter(
          (a) => !a.is_deleted && a.status === "Completed",
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
                const doctorInfo = a.doctor
                  ? `${a.doctor.name} (${a.doctor_id})`
                  : "Unknown Doctor";
                const notesInfo = a.notes ? ` | Notes: ${a.notes}` : "";
                return `  - Appointment ${a.appointment_id} (Token: ${a.token_number}) on ${dateStr} at ${a.appointment_time} with ${doctorInfo} [Status: ${a.status}]${notesInfo}`;
              })
              .join("\n") +
            "\n";
        }

        let expiredText = "";
        if (expiredConfirmedAppts.length > 0) {
          expiredText =
            "\nEXPIRED APPOINTMENTS (Date passed but NOT completed/cancelled):\n" +
            expiredConfirmedAppts
              .map((a) => {
                const dateStr = new Date(a.appointment_date).toLocaleDateString(
                  "en-GB",
                  { day: "2-digit", month: "long", year: "numeric" },
                );
                const doctorInfo = a.doctor
                  ? `${a.doctor.name} (${a.doctor_id})`
                  : "Unknown Doctor";
                const notesInfo = a.notes ? ` | Notes: ${a.notes}` : "";
                return `  - Appointment ${a.appointment_id} on ${dateStr} at ${a.appointment_time} with ${doctorInfo} [Status: ${a.status} - EXPIRED]${notesInfo}`;
              })
              .join("\n") +
            "\n";
        }

        let completedText = "";
        if (completedAppts.length > 0) {
          completedText =
            "\nCOMPLETED APPOINTMENTS (HISTORY):\n" +
            completedAppts
              .map((a) => {
                const dateStr = new Date(a.appointment_date).toLocaleDateString(
                  "en-GB",
                  { day: "2-digit", month: "long", year: "numeric" },
                );
                const doctorInfo = a.doctor
                  ? `with ${a.doctor.name} (${a.doctor_id})`
                  : "";
                return `  - Appointment ${a.appointment_id} on ${dateStr} at ${a.appointment_time} ${doctorInfo} [Completed]`;
              })
              .join("\n") +
            "\n";
        }

        let pastText = "";
        // Keep a combined past section for non-completed, non-expired past appts (edge case)
        const otherPastAppts = recentAppts.filter(
          (a) =>
            !a.is_deleted &&
            a.status !== "Cancelled" &&
            a.status !== "Completed" &&
            a.appointment_date < todayStr &&
            !expiredConfirmedAppts.includes(a),
        );
        if (otherPastAppts.length > 0) {
          pastText =
            "\nPAST APPOINTMENTS (HISTORY):\n" +
            otherPastAppts
              .map((a) => {
                const dateStr = new Date(a.appointment_date).toLocaleDateString(
                  "en-GB",
                  { day: "2-digit", month: "long", year: "numeric" },
                );
                const doctorInfo = a.doctor
                  ? `with ${a.doctor.name} (${a.doctor_id})`
                  : "";
                return `  - Appointment ${a.appointment_id} on ${dateStr} at ${a.appointment_time} ${doctorInfo} [Status: ${a.status}]`;
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
        existingAppointmentsSection =
          activeText + expiredText + completedText + pastText + cancelledText;
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
${commonBasePrompt}

${hospitalPrompt}

STRICT SOURCE OF TRUTH MANDATE:
- The DATA SECTIONS in the appointment prompt are REFRESHED FROM DATABASE for EVERY message you receive.
- BEFORE responding to ANY message, READ and VERIFY all data sections first.
- Use ONLY the "UPCOMING ACTIVE APPOINTMENTS" section to verify if a user has a valid appointment.
- If an appointment ID is NOT in the lists below, it does NOT exist. Do NOT assume, estimate, or hallucinate status.
- If an appointment is in "PAST APPOINTMENTS", it has already happened; do not try to cancel or update it unless explicitly requested for a reschedule.
- If a doctor is listed with status 'busy' or 'off duty', they are currently unavailable for new bookings.
- Data from a previous message in chat history may no longer be accurate — ALWAYS use the current DATA SECTIONS.

KNOWLEDGE BASE STRICT RULE:
- For ANY factual or informational question (about services, clinic, policies, procedures, prices, timings, etc.), you MUST answer ONLY from the "UPLOADED KNOWLEDGE" section below.
- Do NOT use information from previous conversation messages to answer knowledge questions. Previous chat messages may contain outdated or deactivated information.
- If the "UPLOADED KNOWLEDGE" section says "No relevant uploaded documents" or does not contain the answer, respond with: "I don't have that information right now. Let me connect you with our team." and tag [MISSING_KNOWLEDGE: <topic>].
- NEVER make up, guess, or recall factual answers from conversation history. Only the UPLOADED KNOWLEDGE section is the current source of truth.

${leadSourcePrompt}

CURRENT DATE & TIME (${dateTimeInfo.timezoneDisplay}):
Date: ${currentDateFormatted}
Day: ${currentDayFormatted}
Time: ${currentTimeFormatted}
Timezone: ${tenantTimezone}

${calendarReference}

UPLOADED KNOWLEDGE:
${combinedKnowledge}

${appointmentBookingPrompt}
`;

  return {
    systemPrompt,
    knowledgeSources: sources,
    chunks,
    resolvedContext,
  };
};
