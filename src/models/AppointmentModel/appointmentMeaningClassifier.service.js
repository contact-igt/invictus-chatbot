import { callAI } from "../../utils/ai/coreAi.js";
import { detectLanguageAI } from "../../utils/ai/detectLanguageStyle.js";

export const APPOINTMENT_MEANING_INTENTS = {
  BOOK_APPOINTMENT: "BOOK_APPOINTMENT",
  MANAGE_APPOINTMENT: "MANAGE_APPOINTMENT",
  POSSIBLE_BOOKING: "POSSIBLE_BOOKING",
  GENERAL_QUERY: "GENERAL_QUERY",
  UNKNOWN: "UNKNOWN",
};

const APPOINTMENT_MEANING_SUB_INTENTS = new Set([
  "RESCHEDULE_APPOINTMENT",
  "CANCEL_APPOINTMENT",
  "VIEW_APPOINTMENT",
  "CHANGE_APPOINTMENT",
  "ASK_AVAILABILITY",
  "ASK_TIME",
  "ASK_FEES",
  "ASK_LOCATION",
  "ASK_CONFIRMATION",
  null,
]);

const APPOINTMENT_MEANING_ACTIONS = new Set([
  "START_BOOKING",
  "START_MANAGE_FLOW",
  "ASK_CONFIRMATION",
  "CONTINUE_GENERAL_AI",
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const parseText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const safeParseJson = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
};

const normalizeMeaningClassifierResult = (raw = {}, detectedLanguage = {}) => {
  const intent = Object.values(APPOINTMENT_MEANING_INTENTS).includes(raw.intent)
    ? raw.intent
    : APPOINTMENT_MEANING_INTENTS.UNKNOWN;
  const subIntent = APPOINTMENT_MEANING_SUB_INTENTS.has(raw.sub_intent)
    ? raw.sub_intent
    : null;
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Number(clamp(Number(raw.confidence), 0, 1).toFixed(2))
    : 0;
  const language =
    parseText(raw.language) ||
    parseText(detectedLanguage?.label) ||
    parseText(detectedLanguage?.language) ||
    "unknown";
  const reason =
    parseText(raw.reason) ||
    "Unable to classify appointment meaning confidently.";

  let action =
    parseText(raw.action) || APPOINTMENT_MEANING_ACTIONS.CONTINUE_GENERAL_AI;
  if (!APPOINTMENT_MEANING_ACTIONS.has(action)) {
    action = APPOINTMENT_MEANING_ACTIONS.CONTINUE_GENERAL_AI;
  }

  if (intent === APPOINTMENT_MEANING_INTENTS.BOOK_APPOINTMENT) {
    action = APPOINTMENT_MEANING_ACTIONS.START_BOOKING;
  } else if (intent === APPOINTMENT_MEANING_INTENTS.MANAGE_APPOINTMENT) {
    action = APPOINTMENT_MEANING_ACTIONS.START_MANAGE_FLOW;
  } else if (intent === APPOINTMENT_MEANING_INTENTS.POSSIBLE_BOOKING) {
    action = APPOINTMENT_MEANING_ACTIONS.ASK_CONFIRMATION;
  } else if (
    intent === APPOINTMENT_MEANING_INTENTS.GENERAL_QUERY ||
    intent === APPOINTMENT_MEANING_INTENTS.UNKNOWN
  ) {
    action = APPOINTMENT_MEANING_ACTIONS.CONTINUE_GENERAL_AI;
  }

  return {
    intent,
    sub_intent: subIntent,
    confidence,
    language,
    reason,
    action,
  };
};

export const classifyAppointmentMeaning = async ({
  tenantId,
  messageText,
  normalizedMessage,
  previousBotContext = "NONE",
  chatHistory = [],
  activeBookingSession = null,
  activeManageSession = null,
  buttonReplyId = null,
  detectedLanguage = null,
} = {}) => {
  const cleanMessage = parseText(messageText) || "";
  const cleanNormalized = parseText(normalizedMessage) || cleanMessage;

  // Handle both languageContext object (from controller) and simple language string
  let languageInfo;
  if (detectedLanguage) {
    if (typeof detectedLanguage === "object" && detectedLanguage.language) {
      // Full languageContext object from controller
      languageInfo = detectedLanguage;
      
    } else {
      // Fallback: simple string or old format
      languageInfo = detectedLanguage;
    }
  } else if (cleanMessage) {
    // Only detect if no context was provided
    languageInfo = await detectLanguageAI(cleanMessage, tenantId).catch(() => ({
      language: "unknown",
      style: "unknown",
      label: "unknown",
    }));
    
  } else {
    languageInfo = { language: "unknown", style: "unknown", label: "unknown" };
  }

  if (!cleanMessage) {
    return normalizeMeaningClassifierResult({}, languageInfo);
  }

  const prompt = `
You are an appointment meaning classifier for a WhatsApp medical/business chatbot.
Classify the user message by meaning, not by exact keyword matching.

Detected language from system: ${languageInfo?.label || languageInfo?.language || "unknown"}
Detected style from system: ${languageInfo?.style || "unknown"}
Tenant ID: ${tenantId || "unknown"}
Active booking session exists: ${Boolean(activeBookingSession)}
Active manage session exists: ${Boolean(activeManageSession)}
Button reply ID: ${buttonReplyId || "none"}
Previous bot context: ${previousBotContext || "NONE"}

Return ONLY JSON with this exact shape:
{
  "intent": "BOOK_APPOINTMENT" | "MANAGE_APPOINTMENT" | "POSSIBLE_BOOKING" | "GENERAL_QUERY" | "UNKNOWN",
  "sub_intent": "RESCHEDULE_APPOINTMENT" | "CANCEL_APPOINTMENT" | "VIEW_APPOINTMENT" | "CHANGE_APPOINTMENT" | "ASK_AVAILABILITY" | "ASK_TIME" | "ASK_FEES" | "ASK_LOCATION" | "ASK_CONFIRMATION" | null,
  "confidence": 0.0,
  "language": "${languageInfo?.label || languageInfo?.language || "unknown"}",
  "reason": "",
  "action": "START_BOOKING" | "START_MANAGE_FLOW" | "ASK_CONFIRMATION" | "CONTINUE_GENERAL_AI"
}

Rules:
- BOOK_APPOINTMENT: user clearly wants to book, meet, consult, visit, or get an appointment.
- MANAGE_APPOINTMENT: user wants to reschedule, cancel, view, or change an existing appointment.
- POSSIBLE_BOOKING: user is appointment-adjacent but not clearly asking to book; ask confirmation instead.
- GENERAL_QUERY: normal business question, not booking/manage intent.
- UNKNOWN: unclear.
- Use the detected language to keep the "language" field aligned with reply language.
- Do not confuse fees, timing, location, or availability with direct booking.
- If the message is clearly appointment-adjacent but ambiguous, prefer POSSIBLE_BOOKING.
- If the user already has an active booking/manage session, do not misclassify normal progress updates as GENERAL_QUERY.
- Use sub_intent when it helps clarify the user goal.

Message:
"${cleanNormalized}"
`;

  const helperCall = callAI({
    messages: [{ role: "system", content: prompt }],
    tenant_id: tenantId,
    source: "classifier",
    temperature: 0,
    responseFormat: { type: "json_object" },
    maxTokens: 240,
  });

  const timeout = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error("appointment meaning classifier timeout")),
      2500,
    );
  });

  try {
    const result = await Promise.race([helperCall, timeout]);
    const parsed = safeParseJson(result.content) || {};
    return normalizeMeaningClassifierResult(parsed, languageInfo);
  } catch (err) {
    return normalizeMeaningClassifierResult(
      {
        intent: APPOINTMENT_MEANING_INTENTS.UNKNOWN,
        confidence: 0,
        reason: `Meaning classifier failed: ${err.message}`,
        action: APPOINTMENT_MEANING_ACTIONS.CONTINUE_GENERAL_AI,
      },
      languageInfo,
    );
  }
};
