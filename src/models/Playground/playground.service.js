import OpenAI from "openai";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";
import {
  getCommonBasePrompt,
  getAppointmentBookingPrompt,
  getLeadSourcePrompt,
  getPlaygroundSystemPrompt,
  DEFAULT_PLAYGROUND_PROMPT,
} from "../../utils/ai/prompts/index.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { classifyResponse } from "../../utils/ai/responseClassifier.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Search knowledge chunks and return them WITH their source info (title, type, id)
 * so we can show which knowledge base articles were referenced.
 */
export const searchKnowledgeChunksWithSources = async (tenant_id, question) => {
  if (!tenant_id || !question) return { chunks: [], sources: [] };

  // Reuse the existing keyword extraction logic
  const STOP_WORDS = [
    "who",
    "what",
    "is",
    "are",
    "the",
    "this",
    "that",
    "about",
    "tell",
    "me",
    "please",
    "explain",
  ];

  const manualKeywords = question
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.includes(w));

  // AI keyword refinement
  let refinedKeywords = [];
  try {
    const prompt = `Analyze the following customer question and provide a space-separated list of 3-5 key search terms.
    Focus on main topic, synonyms, and intent.
    Question: "${question}"
    Keywords:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 50,
    });

    const aiKeywords = response.choices[0].message.content.trim();
    refinedKeywords = aiKeywords
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  } catch (err) {
    console.error("[PLAYGROUND-SEARCH] AI keyword error:", err.message);
  }

  const keywords = [...new Set([...manualKeywords, ...refinedKeywords])];
  if (!keywords.length) return { chunks: [], sources: [] };

  const conditions = keywords.map(() => "kc.chunk_text LIKE ?").join(" OR ");
  const values = keywords.map((k) => `%${k}%`);

  // Search with source info joined
  const query = `
    SELECT kc.chunk_text, ks.id as source_id, ks.title as source_title, ks.type as source_type
    FROM ${tableNames.KNOWLEDGECHUNKS} kc
    INNER JOIN ${tableNames.KNOWLEDGESOURCE} ks
      ON ks.id = kc.source_id
    WHERE ks.status = 'active'
      AND ks.is_deleted = false
      AND ks.tenant_id IN (?)
      AND (${conditions})
    ORDER BY LENGTH(kc.chunk_text) ASC
    LIMIT 10
  `;

  const [rows] = await db.sequelize.query(query, {
    replacements: [tenant_id, ...values],
  });

  // Extract unique sources WITH their chunk texts grouped
  const sourceMap = new Map();
  rows.forEach((r) => {
    if (!sourceMap.has(r.source_id)) {
      sourceMap.set(r.source_id, {
        id: r.source_id,
        title: r.source_title,
        type: r.source_type,
        chunks: [],
      });
    }
    sourceMap.get(r.source_id).chunks.push(r.chunk_text);
  });

  return {
    chunks: rows.map((r) => r.chunk_text),
    sources: Array.from(sourceMap.values()),
  };
};

/**
 * Main playground chat service.
 * Takes a user message + conversation history, runs it through AI with knowledge base,
 * and returns the response along with knowledge sources used.
 */
export const playgroundChatService = async (
  tenant_id,
  message,
  conversationHistory = [],
  contact_id = null,
) => {
  try {
    // Always define sources and chunks to avoid reference errors
    let sources = [];
    let chunks = [];
    let resolvedContext = "";
    const now = new Date();

    const currentDateFormatted = now.toLocaleDateString("en-IN", {
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

    // --- 1. Fetch Contextual Sections (Doctors, Appointments, Profile, CRM) ---
    let doctorsSection = "No doctors found.";
    let existingAppointmentsSection = "No active appointments found.";
    let patientProfileSection = "No profile details found for this contact.";
    let leadSourcePrompt = "";

    try {
      const { getDoctorListService } = await import("../DoctorModel/doctor.service.js");
      const doctors = await getDoctorListService(tenant_id);
      if (doctors && doctors.length > 0) {
        doctorsSection = doctors
          .map(
            (d) =>
              `${d.title ? d.title + " " : ""}${d.name}${d.specializations && d.specializations.length > 0 ? " (" + d.specializations.map((s) => s.name).join(", ") + ")" : ""}`,
          )
          .join(", ");
      }
    } catch (err) {
      console.error("[PLAYGROUND] Failed to fetch doctors:", err.message);
    }

    if (contact_id) {
      try {
        const { getRecentAppointmentsForAIService } = await import("../AppointmentModel/appointment.service.js");
        const appts = await getRecentAppointmentsForAIService(tenant_id, contact_id);
        if (appts && appts.length > 0) {
          existingAppointmentsSection = appts
            .map((a) => {
              const date = a.appointment_date ? a.appointment_date.toISOString().split("T")[0] : "";
              const time = a.appointment_time || "";
              const doctor = a.doctor ? (a.doctor.title ? a.doctor.title + " " : "") + a.doctor.name : "";
              return `• ${date} at ${time} with ${doctor} (Status: ${a.status})`;
            })
            .join("\n");
        }
      } catch (err) {
        console.error("[PLAYGROUND] Failed to fetch appointments:", err.message);
      }
      try {
        const { getContactByContactIdAndTenantIdService } = await import("../ContactsModel/contacts.service.js");
        const profile = await getContactByContactIdAndTenantIdService(contact_id, tenant_id);
        if (profile) {
          patientProfileSection = `Name: ${profile.name || ""}\nPhone: ${profile.phone || ""}\nEmail: ${profile.email || ""}`;
        }
      } catch (err) {
        console.error("[PLAYGROUND] Failed to fetch patient profile:", err.message);
      }
    }

    // --- 2. Knowledge Base Search ---
    const knowledgeResult = await searchKnowledgeChunksWithSources(tenant_id, message);
    chunks = knowledgeResult.chunks;
    sources = knowledgeResult.sources;

    const knowledgeContext =
      chunks && chunks.length > 0 ? chunks.join("\n\n") : "No relevant uploaded documents.";

    // --- 3. Resolved Logs Search ---
    resolvedContext = "";
    try {
      const logKeywords = message
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2);

      if (logKeywords.length > 0) {
        const logConditions = logKeywords.map(() => "(user_message LIKE ? OR resolution LIKE ?)").join(" OR ");
        const logValues = [];
        logKeywords.forEach((k) => {
          logValues.push(`%${k}%`);
          logValues.push(`%${k}%`);
        });

        const logQuery = `
            SELECT user_message, resolution
            FROM ${tableNames.AI_ANALYSIS_LOGS}
            WHERE tenant_id IN (?)
              AND status = 'resolved'
              AND (${logConditions})
            ORDER BY created_at DESC
            LIMIT 5
          `;

        const [logRows] = await db.sequelize.query(logQuery, {
          replacements: [tenant_id, ...logValues],
        });

        if (logRows.length > 0) {
          resolvedContext = logRows
            .map((log) => `[Previous Question]: ${log.user_message}\n[Admin Resolution]: ${log.resolution}`)
            .join("\n\n");
        }
      }
    } catch (err) {
      console.error("[PLAYGROUND] Resolved logs error:", err.message);
    }

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

    // --- 4. Language & Style Generation (Simulated for Playground) ---
    const languageInfo = {
      language: "detected English",
      style: "helpful and professional",
      label: "playground_sim",
    };

    // --- 5. Assemble Production-Parity System Prompt ---
    const hospitalPrompt = (await getActivePromptService(tenant_id)) || DEFAULT_PLAYGROUND_PROMPT;
    const commonBasePrompt = getCommonBasePrompt(languageInfo);
    const appointmentBookingPrompt = getAppointmentBookingPrompt(
      doctorsSection,
      existingAppointmentsSection,
      patientProfileSection,
    );
    
    // In playground, we can show lead source ask if contact_id is provided but source unknown
    // (For simulation, we'll just skip it for now or include it conditionally)
    leadSourcePrompt = contact_id ? getLeadSourcePrompt(contact_id) : "";

    const systemPrompt = `
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

    // Build message array for OpenAI
    const messages = [{ role: "system", content: systemPrompt }];

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach((msg) => {
        messages.push({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.message,
        });
      });
    }

    // Add current user message
    messages.push({ role: "user", content: message });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1,
      top_p: 0.9,
      max_tokens: 500,
      messages,
    });

    const rawReply = response?.choices?.[0]?.message?.content?.trim();
    const tokenUsage = response?.usage || {};

    console.log("[PLAYGROUND-AI-RAW]", rawReply);

    // Process tags
    const processed = await processResponse(rawReply, {
      tenant_id,
      userMessage: message,
    });

    let finalReply = processed.message;
    let tagExecutionLog = [];

    // If tags detected, simulate execution log (without actually persisting)
    if (processed.tagDetected) {
      tagExecutionLog.push(`Detected tag: [${processed.tagDetected}${processed.tagPayload ? ': ' + processed.tagPayload : ''}]`);
      
      if (processed.tagDetected === "BOOK_APPOINTMENT" && processed.tagPayload) {
        tagExecutionLog.push("Simulating Appointment Booking Handler...");
        // If the AI's reply is empty after removing the tag, show a default confirmation
        if (!finalReply || !finalReply.trim()) {
          finalReply = "✅ [SIMULATED] Your appointment has been booked! (Data not saved to DB)";
        }
      }
    }

    // Classify response
    let classification = null;
    try {
      classification = await classifyResponse(message, finalReply);
      tagExecutionLog.push(`Classification: ${classification.category} (${classification.reason})`);
    } catch (err) {
      console.error("[PLAYGROUND-CLASSIFIER] Error:", err.message);
    }

    return {
      reply: finalReply,
      technicalLogs: {
        systemPrompt: systemPrompt,
        userMessage: message,
        rawAIResponse: rawReply,
        knowledgeChunksUsed: chunks || [],
        resolvedLogsUsed: resolvedContext || "",
        detectedTags: processed.tagDetected ? {
          tag: processed.tagDetected,
          payload: processed.tagPayload
        } : null,
        tagExecutionHistory: tagExecutionLog,
        classification,
      },
      knowledgeSources: sources,
      responseOrigin: chunks && chunks.length > 0 ? "knowledge_base" : "ai_generated",
      tokenUsage: {
        prompt_tokens: tokenUsage.prompt_tokens || 0,
        completion_tokens: tokenUsage.completion_tokens || 0,
        total_tokens: tokenUsage.total_tokens || 0,
      }
    };
  } catch (err) {
    console.error("[PLAYGROUND] Error:", err.message);
    throw err;
  }
};
