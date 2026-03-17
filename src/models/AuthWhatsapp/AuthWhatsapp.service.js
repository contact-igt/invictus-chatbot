import axios from "axios";
import https from "https";
import OpenAI from "openai";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { detectLanguageAI } from "../../utils/ai/detectLanguageStyle.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { classifyResponse } from "../../utils/ai/responseClassifier.js";
import { handleClassification } from "../../utils/ai/classificationHandler.js";
import { 
  getCommonBasePrompt, 
  getLeadSourcePrompt, 
  getAppointmentBookingPrompt,
  DEFAULT_SYSTEM_PROMPT
} from "../../utils/ai/prompts/index.js";

import { getLeadByContactIdService } from "../LeadsModel/leads.service.js";
import { searchResolvedLogsService } from "../AiAnalysisLog/aiAnalysisLog.service.js";
import { getDoctorsForAIService } from "../DoctorModel/doctor.service.js";
import { getRecentAppointmentsForAIService } from "../AppointmentModel/appointment.service.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const httpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
});

export const sendWhatsAppMessage = async (tenant_id, to, message) => {
  try {
    if (!message || !message.trim()) return;

    const [rows] = await db.sequelize.query(
      `
    SELECT phone_number_id, access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND status = 'active'
    LIMIT 1
    `,
      { replacements: [tenant_id] },
    );

    if (!rows.length) {
      throw new Error("No active WhatsApp account for tenant");
    }

    const { phone_number_id, access_token } = rows[0];

    const META_API_VERSION = process.env.META_API_VERSION || "v22.0";
    console.log(
      `[SEND-MSG] Using Meta API version: ${META_API_VERSION}, phone_number_id: ${phone_number_id}, to: ${to}`,
    );

    let wamid = null;
    try {
      const response = await axios.post(
        `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message.trim() },
        },
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          httpsAgent,
        },
      );
      wamid = response?.data?.messages?.[0]?.id || null;
    } catch (axiosErr) {
      if (axiosErr.response) {
        console.error(
          "[SEND-MSG] Meta API Error:",
          JSON.stringify(axiosErr.response.data, null, 2),
        );
        const metaErr = axiosErr.response.data?.error || {};
        const metaMsg = metaErr.message || axiosErr.message;
        const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
        const subcode = metaErr.error_subcode ? ` (Subcode: ${metaErr.error_subcode})` : "";
        throw new Error(`Meta API Error: ${metaMsg}${code}${subcode}`);
      }
      throw axiosErr;
    }

    return { phone_number_id, wamid };
  } catch (err) {
    throw err;
  }
};

export const sendWhatsAppTemplate = async (
  tenant_id,
  to,
  templateName,
  languageCode,
  components,
) => {
  const [rows] = await db.sequelize.query(
    `
    SELECT phone_number_id, access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND status = 'active'
    LIMIT 1
    `,
    { replacements: [tenant_id] },
  );

  if (!rows.length) {
    throw new Error("No active WhatsApp account for tenant");
  }

  const { phone_number_id, access_token } = rows[0];

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode,
      },
      components: components || [],
    },
  };

  const META_API_VERSION = process.env.META_API_VERSION || "v22.0";
  console.log(
    `[SEND-TEMPLATE] Using Meta API version: ${META_API_VERSION}, phone_number_id: ${phone_number_id}, to: ${to}`,
  );

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

    const meta_message_id = response.data?.messages?.[0]?.id;

    return { phone_number_id, meta_message_id };
  } catch (error) {
    if (error.response) {
      console.error(
        "Meta API Error Details:",
        JSON.stringify(error.response.data, null, 2),
      );
      const metaErr = error.response.data?.error || {};
      const message = metaErr.message || error.message;
      const code = metaErr.code ? ` (Code: ${metaErr.code})` : "";
      const subcode = metaErr.error_subcode ? ` (Subcode: ${metaErr.error_subcode})` : "";
      throw new Error(`Meta API Error: ${message}${code}${subcode}`);
    }
    throw error;
  }
};

export const sendTypingIndicator = async (tenant_id, phone_number_id, to) => {
  try {
    const [rows] = await db.sequelize.query(
      `
    SELECT access_token
    FROM ${tableNames.WHATSAPP_ACCOUNT}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND status = 'active'
    LIMIT 1
    `,
      { replacements: [tenant_id, phone_number_id] },
    );

    if (!rows.length) return;

    const META_API_VERSION = process.env.META_API_VERSION || "v22.0";
    await axios.post(
      `https://graph.facebook.com/${META_API_VERSION}/${phone_number_id}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "typing",
      },
      {
        headers: {
          Authorization: `Bearer ${rows[0].access_token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    throw err;
  }
};

export const isMessageProcessed = async (
  tenant_id,
  phone_number_id,
  message_id,
) => {
  try {
    const Query = `SELECT * FROM ${tableNames?.PROCESSEDMESSAGE} WHERE tenant_id = ? AND phone_number_id = ? AND message_id = ?`;

    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, phone_number_id, message_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const markMessageProcessed = async (
  tenant_id,
  phone_number_id,
  message_id,
  phone,
) => {
  try {
    const [result] = await db.sequelize.query(
      `INSERT IGNORE INTO ${tableNames.PROCESSEDMESSAGE}
     (tenant_id, phone_number_id, message_id, phone)
     VALUES (?, ?, ? , ?)`,
      { replacements: [tenant_id, phone_number_id, message_id, phone] },
    );
    return result;
  } catch (err) {
    throw err;
  }
};

export const isChatLocked = async (tenant_id, phone_number_id, phone) => {
  try {
    const [rows] = await db.sequelize.query(
      `
    SELECT 1
    FROM ${tableNames.CHATLOCKS}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND phone = ?
      AND created_at > (NOW() - INTERVAL 15 SECOND)
    LIMIT 1
    `,
      { replacements: [tenant_id, phone_number_id, phone] },
    );

    return rows.length > 0;
  } catch (err) {
    throw err;
  }
};

export const lockChat = async (tenant_id, phone_number_id, phone) => {
  try {
    await db.sequelize.query(
      `
    INSERT IGNORE INTO ${tableNames.CHATLOCKS}
    (tenant_id, phone_number_id, phone)
    VALUES (?,?,?)
    `,
      { replacements: [tenant_id, phone_number_id, phone] },
    );
  } catch (err) {
    throw err;
  }
};

export const unlockChat = async (tenant_id, phone_number_id, phone) => {
  try {
    await db.sequelize.query(
      `
    DELETE FROM ${tableNames.CHATLOCKS}
    WHERE tenant_id = ?
      AND phone_number_id = ?
      AND phone = ?
    `,
      { replacements: [tenant_id, phone_number_id, phone] },
    );
  } catch (err) {
    throw err;
  }
};

export const getOpenAIReply = async (
  tenant_id,
  phone,
  userMessage,
  contact_id = null,
  phone_number_id = null,
) => {
  try {
    if (!userMessage) return null;

    const cleanMessage = userMessage.trim();
    if (!cleanMessage) return null;

    const now = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
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

    const languageInfo = await detectLanguageAI(cleanMessage);

    console.log("language", languageInfo);

    const memory = await getConversationMemory(tenant_id, phone);
    const chatHistory = buildChatHistory(memory);

    const hospitalPrompt =
      (await getActivePromptService(tenant_id)) || DEFAULT_SYSTEM_PROMPT;

    const chunks = await searchKnowledgeChunks(tenant_id, cleanMessage);

    // NEW: Fetch resolved logs
    const resolvedLogs = await searchResolvedLogsService(tenant_id, 5);
    const resolvedContext = resolvedLogs
      .map(
        (log) =>
          `[Previous Question]: ${log.user_message}\n[Admin Resolution]: ${log.resolution}`,
      )
      .join("\n\n");

    const knowledgeContext =
      chunks && chunks.length > 0
        ? chunks.join("\n\n")
        : "No relevant uploaded documents.";

    const combinedKnowledge = `
${knowledgeContext}

${
  resolvedLogs.length > 0
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

    const COMMON_BASE_PROMPT = getCommonBasePrompt(languageInfo);

    // Patient profile section for smarter collection
    let patientProfileSection = "";
    if (contact_id) {
      try {
        const contact = await db.Contacts.findOne({
          where: { contact_id, tenant_id },
          attributes: ["name", "email", "mobile"],
        });
        if (contact) {
          patientProfileSection = `PATIENT PROFILE:\n- Name: ${contact.name || "Unknown"}\n- Email: ${contact.email || "Missing"}\n- Mobile: ${contact.mobile || "Known"}`;
        }
      } catch (err) {
        console.error("[PATIENT_PROFILE] Error fetching profile:", err.message);
      }
    }

    // Lead source detection prompt (only when source is unknown)
    let leadSourcePrompt = "";
    if (contact_id) {
      try {
        const lead = await getLeadByContactIdService(tenant_id, contact_id);
        if (lead && lead.source === "none") {
          leadSourcePrompt = getLeadSourcePrompt(contact_id);
        }
      } catch (err) {
        console.error("[LEAD_SOURCE] Error checking lead source:", err.message);
      }
    }

    let appointmentBookingPrompt = "";
    try {
      const doctorsList = await getDoctorsForAIService(tenant_id);
      const doctorsSection = doctorsList
        ? `AVAILABLE DOCTORS:\n${doctorsList}`
        : "No doctors are currently available for booking.";

      let existingAppointmentsSection = "";
      if (contact_id) {
        const recentAppts = await getRecentAppointmentsForAIService(tenant_id, contact_id);
        if (recentAppts && recentAppts.length > 0) {
          const activeAppts = recentAppts.filter(a => !a.is_deleted && a.status !== "Cancelled");
          const cancelledAppts = recentAppts.filter(a => a.is_deleted || a.status === "Cancelled");

          let activeText = "";
          if (activeAppts.length > 0) {
            activeText = "\nEXISTING ACTIVE APPOINTMENTS (SOURCE OF TRUTH):\n" + activeAppts.map((a) => {
              const dateStr = new Date(a.appointment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
              return `  - Appointment ${a.appointment_id} (Token: ${a.token_number}) on ${dateStr} at ${a.appointment_time} with ${a.doctor?.name || "Unknown Doctor"} [Status: ${a.status}]`;
            }).join("\n") + "\n";
          }

          let cancelledText = "";
          if (cancelledAppts.length > 0) {
            cancelledText = "\nRECENTLY CANCELLED/DELETED APPOINTMENTS (PAST 24H):\n" + cancelledAppts.map((a) => {
              const dateStr = new Date(a.appointment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
              return `  - Appointment ${a.appointment_id} on ${dateStr} was CANCELLED/DELETED.`;
            }).join("\n") + "\n";
          }
          existingAppointmentsSection = activeText + cancelledText;
        }
      }
      appointmentBookingPrompt = getAppointmentBookingPrompt(doctorsSection, existingAppointmentsSection, patientProfileSection);
    } catch (err) {
      console.error("[APPOINTMENT_PROMPT] Error fetching data:", err.message);
    }

    const systemPrompt = `
    
${leadSourcePrompt}

${appointmentBookingPrompt}

${COMMON_BASE_PROMPT}

${hospitalPrompt}

CURRENT DATE & DAY & TIME (IST):
Date: ${currentDateFormatted}
Day: ${currentDayFormatted}
Time: ${currentTimeFormatted}

UPLOADED KNOWLEDGE:
${combinedKnowledge}
`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...chatHistory,
      { role: "user", content: cleanMessage },
    ];

    let response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1, // Very low temperature for consistent tagging behavior
      top_p: 0.9,
      max_tokens: 800,
      messages: aiMessages,
    });

    let rawReply = response?.choices?.[0]?.message?.content?.trim();

    // If response was truncated (finish_reason: 'length') and contains a partial tag, retry with more tokens
    const finishReason = response?.choices?.[0]?.finish_reason;
    if (finishReason === "length" && rawReply) {
      const hasPartialTag =
        /\[([A-Z_]+)(?::\s*[\s\S]*)?$/.test(rawReply) &&
        !/\[([A-Z_]+)(?::\s*[\s\S]*?)\]/.test(rawReply);
      if (hasPartialTag) {
        console.warn(
          "[WHATSAPP-AI] Response truncated with partial tag, retrying with higher token limit...",
        );
        response = await openai.chat.completions.create({
          model: "gpt-4o",
          temperature: 0.1,
          top_p: 0.9,
          max_tokens: 1200,
          messages: aiMessages,
        });
        rawReply = response?.choices?.[0]?.message?.content?.trim();
      }
    }

    console.log("[WHATSAPP-AI-RAW]", rawReply);

    // Step 1: Clean any residual manual tags and extract metadata
    const processed = await processResponse(rawReply, {
      tenant_id,
      userMessage: cleanMessage,
      contact_id,
      phone,
      phone_number_id,
    });

    const finalReply = processed.message;

    // Step 2: NEW Dual-AI Classification (Standardized single logging)
    try {
      console.log("[CLASSIFIER] Starting classification...");
      const classification = await classifyResponse(cleanMessage, finalReply);

      // If the primary AI explicitly tagged missing knowledge or out of scope, use that as a "hint"
      if (
        processed.tagDetected === "MISSING_KNOWLEDGE" &&
        classification.category !== "MISSING_KNOWLEDGE"
      ) {
        classification.category = "MISSING_KNOWLEDGE";
        classification.reason = processed.tagPayload || classification.reason;
      } else if (
        processed.tagDetected === "OUT_OF_SCOPE" &&
        classification.category !== "OUT_OF_SCOPE"
      ) {
        classification.category = "OUT_OF_SCOPE";
        classification.reason = processed.tagPayload || classification.reason;
      }

      await handleClassification(classification, {
        tenant_id,
        userMessage: cleanMessage,
        aiResponse: finalReply,
      });
    } catch (classifierError) {
      console.error(
        "[CLASSIFIER] Error in dual-AI flow:",
        classifierError.message,
      );
    }

    console.log("[WHATSAPP-AI-FINAL]", finalReply);

    return {
      message: finalReply || null,
      tagDetected: processed.tagDetected,
      tagPayload: processed.tagPayload,
    };
  } catch (err) {
    console.error("OpenAI error:", err.message);
    return { message: null, tagDetected: null, tagPayload: null };
  }
};
