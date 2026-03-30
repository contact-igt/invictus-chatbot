import db from "../../database/index.js";
import { searchKnowledgeChunks } from "../../models/Knowledge/knowledge.search.js";
import { getActivePromptService } from "../../models/AiPrompt/aiprompt.service.js";
import {
  getCommonBasePrompt,
  getLeadSourcePrompt,
  DEFAULT_SYSTEM_PROMPT,
} from "./prompts/index.js";
import { getLeadByContactIdService } from "../../models/LeadsModel/leads.service.js";
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
  let businessName = "our business";
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

  const currentDateFormatted = dateTimeInfo.date;
  const currentDayFormatted = dateTimeInfo.day;
  const currentTimeFormatted = dateTimeInfo.time;

  // 1. Fetch Prompts & Knowledge (use cached if pre-fetched for parallel optimization)
  let hospitalPrompt = DEFAULT_SYSTEM_PROMPT;
  if (cachedData.activePrompt !== undefined) {
    hospitalPrompt = cachedData.activePrompt || DEFAULT_SYSTEM_PROMPT;
  } else {
    try {
      hospitalPrompt =
        (await getActivePromptService(tenant_id)) || DEFAULT_SYSTEM_PROMPT;
    } catch (promptErr) {
      console.error(
        "[AI-FLOW-HELPER] Active prompt fetch failed:",
        promptErr.message,
      );
    }
  }

  const commonBasePrompt = getCommonBasePrompt(languageInfo, businessName);

  let chunks = [];
  let resolvedLogs = [];
  let sources = [];

  if (cachedData.knowledgeResult) {
    // Use pre-fetched knowledge result (parallel fetch optimization)
    chunks = cachedData.knowledgeResult.chunks || [];
    resolvedLogs = cachedData.knowledgeResult.resolvedLogs || [];
    sources = cachedData.knowledgeResult.sources || [];
  } else {
    try {
      const searchResult = await searchKnowledgeChunks(tenant_id, userMessage);
      chunks = searchResult.chunks || [];
      resolvedLogs = searchResult.resolvedLogs || [];
      sources = searchResult.sources || [];
    } catch (knErr) {
      console.error("[AI-FLOW-HELPER] Knowledge search failed:", knErr.message);
    }
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
          attributes: ["name", "email", "phone", "age"],
        }));
      if (contact) {
        const emailStatus = contact.email
          ? `${contact.email} (on file — DO NOT ask again)`
          : "NOT PROVIDED — ask when natural";
        const ageStatus = contact.age != null ? `${contact.age}` : "Unknown";
        patientProfileSection = `CONTACT PROFILE:\n- Name: ${contact.name || "Unknown"}\n- Email: ${emailStatus}\n- Age: ${ageStatus}\n- Phone: ${contact.phone || "Known"}`;
      }

      // Use cached lead or fetch if not provided
      const lead =
        cachedData.lead ||
        (await getLeadByContactIdService(tenant_id, contact_id));
      if (lead && lead.source === "none") {
        leadSourcePrompt = getLeadSourcePrompt(contact_id);
      } else if (lead && lead.source !== "none") {
        // Lead source already known — tell AI not to ask
        patientProfileSection += `\n- Lead Source: ${lead.source} (on file — DO NOT ask again)`;
      }
    } catch (err) {
      console.error("[AI-FLOW-HELPER] Context error:", err.message);
    }
  }

  const systemPrompt = `
${commonBasePrompt}

═══════════════════════════════
BUSINESS INSTRUCTIONS
═══════════════════════════════
${hospitalPrompt}

${patientProfileSection ? `${patientProfileSection}\n` : ""}
${leadSourcePrompt}

═══════════════════════════════
KNOWLEDGE BASE RULE
═══════════════════════════════
- For factual questions (services, policies, prices, timings, etc.) → answer ONLY from the UPLOADED KNOWLEDGE section below.
- Do NOT answer factual questions from chat history — it may be outdated.
- If the answer is not in UPLOADED KNOWLEDGE → say "Let me check with the team." + [MISSING_KNOWLEDGE: topic]
- Never make up or guess factual information.

═══════════════════════════════
CURRENT DATE & TIME (${dateTimeInfo.timezoneDisplay})
═══════════════════════════════
Date: ${currentDateFormatted}
Day: ${currentDayFormatted}
Time: ${currentTimeFormatted}
Timezone: ${tenantTimezone}

${calendarReference}

═══════════════════════════════
UPLOADED KNOWLEDGE
═══════════════════════════════
${combinedKnowledge}
`;

  return {
    systemPrompt,
    knowledgeSources: sources,
    chunks,
    resolvedContext,
  };
};
