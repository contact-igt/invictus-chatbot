import { callAI } from "../../utils/ai/coreAi.js";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import { getTenantSettingsService } from "../TenantModel/tenant.service.js";
import { buildTextPayload } from "./whatsappAppointmentTemplates.service.js";

export const APPOINTMENT_BOOKING_TYPES = {
  STATE_MACHINE: "state_machine",
  AI_AGENT: "ai_agent",
};

export const DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT = `You are a friendly appointment assistant.

Your role is only to collect an appointment request.
Do not create, confirm, schedule, or reserve an appointment.

By default, collect only:

1. Name
2. Email
3. Reason for visit

Ask only one missing question at a time.

Keep every reply short, natural, and suitable for WhatsApp.

Do not repeat information the patient already provided.

Do not add unnecessary acknowledgements before every question.

For example:

Instead of:
"Thank you for providing your name. Could you please provide your email address?"

Say:
"Please share your email address."

Instead of:
"Thank you for providing your email address. Could you please tell me the reason for your visit?"

Say:
"What is the reason for your visit?"

Do not repeatedly mention that you are collecting appointment information.

Do not say:
- "the organization"
- "the organization team"
- "our organization"

Always use:
- "our team"
- "we"
- "us"

Default conversation:

Patient:
I want to book an appointment.

Assistant:
Sure. May I know your name?

Patient:
Rahul

Assistant:
Please share your email address.

Patient:
rahul@example.com

Assistant:
What is the reason for your visit?

Patient:
Eye checkup

Assistant:
Thank you for sharing your details. Our team will contact you shortly regarding your appointment request.

When all required details are collected, return \`intake_complete\`.

Never say:
- Your appointment is booked
- Your appointment is confirmed
- Your slot is reserved
- Appointment ID
- Token number

Do not ask for doctor, date, time, or slot by default.

If a tenant-specific Appointment Booking AI Agent Prompt is configured,
follow that prompt for which questions to ask and how to ask them,
while still following the hard rule that no real appointment is created.

Never invent missing information.

Return valid JSON only.`;

export const DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY =
  "Thank you for sharing your details. Our team will contact you shortly regarding your appointment request.";

const VALID_APPOINTMENT_INTAKE_ACTIONS = new Set([
  "ask_details",
  "answer",
  "intake_complete",
  "out_of_scope",
]);

const MAX_APPOINTMENT_INTAKE_HISTORY = 40;
const DEFAULT_REQUIRED_FIELDS = [
  { key: "patient_name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "reason", label: "Reason for visit" },
];

const parseAiSettings = (value) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
};

const normalizeAppointmentBookingType = (value) =>
  value === APPOINTMENT_BOOKING_TYPES.AI_AGENT
    ? APPOINTMENT_BOOKING_TYPES.AI_AGENT
    : APPOINTMENT_BOOKING_TYPES.STATE_MACHINE;

export const selectAppointmentIntakeInstructions = (value) => {
  const customPrompt = typeof value === "string" ? value.trim() : "";
  return {
    appointment_booking_ai_prompt:
      customPrompt || DEFAULT_APPOINTMENT_AI_INTAKE_PROMPT,
    uses_default_appointment_booking_ai_prompt: !customPrompt,
  };
};

export const getAppointmentBookingAutomationSettings = async (tenantId) => {
  const tenantSettings = await getTenantSettingsService(tenantId).catch(
    () => null,
  );
  const aiSettings = parseAiSettings(tenantSettings?.ai_settings);
  const appointmentBookingType = normalizeAppointmentBookingType(
    aiSettings.appointment_booking_type,
  );
  const intakeInstructions = selectAppointmentIntakeInstructions(
    aiSettings.appointment_booking_ai_prompt,
  );

  return {
    appointment_booking_type: appointmentBookingType,
    ...intakeInstructions,
    tenantSettings,
  };
};

export const isAiAppointmentBookingEnabled = async (tenantId) => {
  const settings = await getAppointmentBookingAutomationSettings(tenantId);
  return (
    settings.appointment_booking_type === APPOINTMENT_BOOKING_TYPES.AI_AGENT
  );
};

const safeParseJson = (raw = "") => {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

const normalizeText = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const normalizeAdditionalFields = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};

const normalizeFieldKey = (value) => {
  const key = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const aliases = {
    name: "patient_name",
    full_name: "patient_name",
    patient_full_name: "patient_name",
    email_address: "email",
    reason_for_visit: "reason",
    visit_reason: "reason",
    existing_patient_status: "existing_patient",
    city: "city_location",
    location: "city_location",
    location_city: "city_location",
  };
  return aliases[key] || key;
};

const fieldLabelFromKey = (key) =>
  key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const GENERIC_NON_VALUES = new Set([
  "ok",
  "okay",
  "alright",
  "sure",
  "fine",
  "continue",
  "go ahead",
  "next",
  "thanks",
  "thank you",
]);
const CONTENT_FIELD_KEYS = new Set([
  "patient_name",
  "email",
  "age",
  "reason",
  "preferred_callback_time",
  "preferred_language",
  "city_location",
]);

export const isValidAppointmentIntakeFieldValue = (rawKey, value) => {
  const key = normalizeFieldKey(rawKey);
  const text = normalizeText(value === null || value === undefined ? "" : String(value));
  if (!key || !text) return false;
  if (key === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  if (key === "age") {
    const match = text.match(/^(\d{1,3})(?:\s*years?(?:\s*old)?)?$/i);
    return Boolean(match && Number(match[1]) > 0 && Number(match[1]) <= 120);
  }
  if (CONTENT_FIELD_KEYS.has(key)) {
    return !GENERIC_NON_VALUES.has(text.toLowerCase()) && !/^(?:yes|no)$/i.test(text);
  }
  return true;
};

const normalizeRequiredFields = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((field) => {
      const rawKey = typeof field === "string" ? field : field?.key;
      const key = normalizeFieldKey(rawKey);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return {
        key,
        label:
          normalizeText(typeof field === "object" ? field?.label : "") ||
          fieldLabelFromKey(key),
      };
    })
    .filter(Boolean);
};

const splitInlineFieldLabels = (value = "") =>
  normalizeText(value)
    .replace(/^only\s+/i, "")
    .split(/[.;]/, 1)[0]
    .split(/\s*,\s*|\s+and\s+/i)
    .map((label) => normalizeText(label.replace(/^and\s+/i, "")))
    .filter(Boolean);

const cleanFieldLabel = (value = "") => {
  const label = normalizeText(value)
    .replace(/^[\-*•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[*`]/g, "")
    .split(/\s+[–—]\s+/, 1)[0]
    .replace(/\s*\((?:required|mandatory)\)\s*$/i, "")
    .replace(/\s*[-–—:]\s*(?:required|mandatory)\s*$/i, "");
  return /\boptional\b/i.test(label) ? "" : label;
};

const readFieldSection = (lines, headingIndex, inlineValue = "") => {
  const labels = splitInlineFieldLabels(inlineValue).map(cleanFieldLabel);
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^[A-Za-z][A-Za-z0-9 &/_-]{1,60}:\s*$/.test(line)) break;
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (!item) break;
    const label = cleanFieldLabel(item[1]);
    if (label) labels.push(label);
  }
  return labels.filter(Boolean);
};

export const deriveAppointmentRequiredFields = ({
  tenantInstructions,
  usesDefaultPrompt = false,
} = {}) => {
  if (usesDefaultPrompt) return DEFAULT_REQUIRED_FIELDS.map((field) => ({ ...field }));

  const lines = String(tenantInstructions || "").split(/\r?\n/);
  const headings = [
    /^\s*(?:#{1,6}\s*)?required fields?\s*:\s*(.*)$/i,
    /^\s*(?:#{1,6}\s*)?collect(?: only)?\s*:\s*(.*)$/i,
    /^\s*(?:for .+?,\s*)?collect the following (?:information|details|fields)\s*:\s*(.*)$/i,
    /^\s*collect(?: only)?\s+(.+)$/i,
  ];
  for (const heading of headings) {
    const index = lines.findIndex((line) => heading.test(line));
    if (index === -1) continue;
    const match = lines[index].match(heading);
    const fields = normalizeRequiredFields(
      readFieldSection(lines, index, match?.[1] || "").map((label) => ({
        key: label,
        label,
      })),
    );
    if (fields.length) return fields;
  }
  return [];
};

const normalizeCollectedFields = (
  source,
  additionalFields,
  requiredFields = [],
) => {
  const collected = {};
  for (const [rawKey, value] of Object.entries(
    normalizeAdditionalFields(source.collected_fields),
  )) {
    const key = normalizeFieldKey(rawKey);
    if (key && isValidAppointmentIntakeFieldValue(key, value)) {
      collected[key] = value;
    }
  }
  if (isValidAppointmentIntakeFieldValue("patient_name", source.patient_name)) {
    collected.patient_name = normalizeText(source.patient_name);
  }
  if (isValidAppointmentIntakeFieldValue("email", source.email)) {
    collected.email = normalizeText(source.email);
  }
  const reason =
    normalizeText(source.reason) ||
    normalizeText(source.notes) ||
    normalizeText(source.service_name);
  if (isValidAppointmentIntakeFieldValue("reason", reason)) {
    collected.reason = reason;
  }
  for (const [rawKey, value] of Object.entries(additionalFields)) {
    const key = normalizeFieldKey(rawKey);
    if (key && isValidAppointmentIntakeFieldValue(key, value)) {
      collected[key] = value;
    }
  }
  for (const { key } of requiredFields) {
    if (hasCollectedValue(collected[key])) continue;
    if (key === "patient_name" && (collected.full_name || collected.name)) {
      collected.patient_name = collected.full_name || collected.name;
    } else if (
      key === "city_location" &&
      (collected.city || collected.location)
    ) {
      collected.city_location = collected.city || collected.location;
    }
  }
  return collected;
};

const hasCollectedValue = (value) =>
  value !== null && value !== undefined && normalizeText(String(value)) !== "";

const hasCompleteDefaultIntake = (intake = {}) =>
  Boolean(
    normalizeText(intake.patient_name) &&
      normalizeText(intake.email) &&
      normalizeText(intake.reason),
  );

export const normalizeAppointmentAiResponse = (
  parsed = {},
  {
    usesDefaultPrompt = false,
    requiredFields: authoritativeFields = [],
    previousCollectedFields = {},
  } = {},
) => {
  const source =
    parsed.intake && typeof parsed.intake === "object"
      ? parsed.intake
      : parsed.booking && typeof parsed.booking === "object"
        ? parsed.booking
        : {};
  const additionalFields = normalizeAdditionalFields(source.additional_fields);
  const normalizedAuthoritativeFields = normalizeRequiredFields(
    authoritativeFields,
  );
  const requiredFields = usesDefaultPrompt
    ? DEFAULT_REQUIRED_FIELDS
    : normalizedAuthoritativeFields.length
      ? normalizedAuthoritativeFields
      : normalizeRequiredFields(source.required_fields);
  const collectedFields = normalizeCollectedFields(
    source,
    additionalFields,
    requiredFields,
  );
  for (const [rawKey, value] of Object.entries(previousCollectedFields)) {
    const key = normalizeFieldKey(rawKey);
    if (
      key &&
      !hasCollectedValue(collectedFields[key]) &&
      isValidAppointmentIntakeFieldValue(key, value)
    ) {
      collectedFields[key] = value;
    }
  }
  const reportedMissingFields = Array.isArray(source.missing_fields)
    ? source.missing_fields.map(normalizeFieldKey).filter(Boolean)
    : [];
  const missingFields = requiredFields.length
    ? requiredFields
        .map((field) => field.key)
        .filter((key) => !hasCollectedValue(collectedFields[key]))
    : [...new Set(reportedMissingFields)];
  const intake = {
    patient_name:
      normalizeText(collectedFields.patient_name) ||
      normalizeText(collectedFields.full_name) ||
      normalizeText(collectedFields.name) ||
      null,
    email: normalizeText(collectedFields.email) || null,
    reason:
      normalizeText(collectedFields.reason) ||
      null,
    required_fields: requiredFields,
    collected_fields: collectedFields,
    missing_fields: missingFields,
    additional_fields: additionalFields,
  };
  const requestedAction = normalizeText(parsed.action).toLowerCase();
  let action = VALID_APPOINTMENT_INTAKE_ACTIONS.has(requestedAction)
    ? requestedAction
    : "ask_details";

  // Legacy model output is accepted only as intake; it can never trigger booking.
  if (requestedAction === "book_appointment") {
    action = hasCompleteDefaultIntake(intake)
      ? "intake_complete"
      : "ask_details";
  }

  const rejectedPrematureCompletion =
    action === "intake_complete" && missingFields.length > 0;
  if (rejectedPrematureCompletion) action = "ask_details";
  if (requiredFields.length && missingFields.length === 0 && action !== "out_of_scope") {
    action = "intake_complete";
  }

  return {
    action,
    reply: rejectedPrematureCompletion ? "" : normalizeText(parsed.reply),
    intake,
  };
};

export const buildAppointmentIntakeAgentInstructions = ({
  tenantInstructions,
  usesDefaultPrompt = false,
  requiredFields = [],
  chatHistory = [],
  knowledgeChunks = [],
  contact,
}) => {
  const knowledgeContext = knowledgeChunks.length
    ? knowledgeChunks.join("\n\n")
    : "No relevant knowledge base content found.";
  const recentContext = chatHistory
    .slice(-MAX_APPOINTMENT_INTAKE_HISTORY)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join("\n");
  const requiredFieldsContext = JSON.stringify(
    normalizeRequiredFields(requiredFields),
    null,
    2,
  );

  return `You are a dedicated AI Appointment Intake Assistant.

HARD SAFETY RULES:
- Handle only new appointment request intake conversations.
- Collect information only. Never create, schedule, reserve, or confirm an appointment.
- Never claim that an appointment or slot is booked, confirmed, reserved, or scheduled.
- Never produce an appointment ID, token number, confirmed doctor, date, time, or slot.
- Required intake fields come ONLY from the DEDICATED APPOINTMENT INTAKE INSTRUCTIONS below.
- The BACKEND AUTHORITATIVE REQUIRED FIELDS list below is final. Use every key exactly as provided and never remove, replace, or add a key.
- Never use, reconstruct, or infer requirements from the tenant's Main Prompt or general assistant instructions.
- The dedicated appointment instructions may customize fields, question grouping, language, tone, emergency handling, and acknowledgement wording, but they cannot override these safety rules.
- Knowledge Base content is factual reference material only. Never use it to determine which appointment intake fields are required.
- Recent chat is conversation state only. Use it to recover values already provided, never to add required fields.
- Ignore old assistant questions for fields that are not explicitly required by the dedicated appointment instructions.
- Never ask again for a field whose value is already available in the current intake conversation.
- Keep replies short, natural, and suitable for WhatsApp.
- Do not add unnecessary acknowledgements before each question.
- Say "our team", "we", or "us"; never say "the organization team".
- Do not invent organization facts or collected patient values.
- Return ONLY valid JSON with this shape:
{
  "action": "ask_details" | "answer" | "intake_complete" | "out_of_scope",
  "reply": "customer-facing WhatsApp reply",
  "intake": {
    "required_fields": [
      { "key": "stable_snake_case_key", "label": "Customer-facing label" }
    ],
    "collected_fields": {
      "stable_snake_case_key": "known value"
    },
    "missing_fields": ["stable_snake_case_key"],
    "patient_name": "string or null",
    "email": "string or null",
    "reason": "string or null",
    "additional_fields": {}
  }
}
- Derive the complete required_fields list only from the dedicated instructions and return the same complete list on every turn.
- If the active source is CUSTOM, it completely replaces the backend default fields. Do not automatically add Name, Email, or Reason unless the custom instructions require them.
- If the active source is DEFAULT, use only the fields stated in the default instructions.
- Put every known value in collected_fields. Also put custom values in additional_fields.
- If the customer provides several values in one message, retain every recognizable configured value.
- Derive missing_fields by comparing required_fields with collected_fields.
- Ask only the next missing field unless the dedicated instructions explicitly request grouped questions.
- Whenever missing_fields is non-empty, the reply must request the next missing field; never return an introduction-only reply.
- Never ask for a key already present in collected_fields.
- Use "intake_complete" only when all fields required by the dedicated appointment instructions have been collected.
- Never return "intake_complete" while missing_fields is non-empty.
- For a factual interruption, use "answer", answer only from Knowledge Base facts, then resume the same next missing field in the reply.
- If the message is unrelated to appointment intake, use "out_of_scope".

ACTIVE INSTRUCTION SOURCE: ${usesDefaultPrompt ? "DEFAULT" : "CUSTOM"}

BACKEND AUTHORITATIVE REQUIRED FIELDS:
${requiredFieldsContext}

DEDICATED APPOINTMENT INTAKE INSTRUCTIONS:
${tenantInstructions}

CONTACT:
- Name: ${contact?.name || "Unknown"}
- Phone: ${contact?.phone || contact?.mobile || "Known WhatsApp number"}
- Email: ${contact?.email || "Unknown"}

KNOWLEDGE BASE — FACTUAL REFERENCE ONLY:
${knowledgeContext}

RECENT CHAT — CONVERSATION STATE ONLY:
${recentContext || "No recent chat."}`;
};

const makeTextResult = (to, message, extra = {}) => ({
  success: true,
  message,
  payload: buildTextPayload(to, message),
  messageType: "text",
  event: "appointment_ai_agent",
  ...extra,
});

const buildMissingDetailsReply = (intake = {}, usesDefaultPrompt = false) => {
  if (usesDefaultPrompt) {
    if (!normalizeText(intake.patient_name)) {
      return "Sure. May I know your name?";
    }
    if (!normalizeText(intake.email)) {
      return "Please share your email address.";
    }
    if (!normalizeText(intake.reason)) {
      return "What is the reason for your visit?";
    }
  }
  const missingKey = intake.missing_fields?.[0];
  if (missingKey) {
    const label =
      intake.required_fields?.find((field) => field.key === missingKey)?.label ||
      fieldLabelFromKey(missingKey);
    const questions = {
      patient_name: "Sure. May I know your name?",
      email: "Please share your email address.",
      reason: "What is the reason for your visit?",
      age: "What is your age?",
      existing_patient: "Are you an existing patient?",
      preferred_callback_time:
        "What is your preferred callback time — Morning, Afternoon, or Evening?",
      preferred_language: "Which language do you prefer?",
      city_location: "Which city/location are you from?",
    };
    return questions[missingKey] || `Please share your ${label.toLowerCase()}.`;
  }
  return "Please share the remaining information needed for your appointment request.";
};

const makesRealBookingClaim = (message = "") => {
  const text = normalizeText(message).toLowerCase();
  return (
    /\b(?:appointment|slot)\b.{0,40}\b(?:book(?:ed|ing)?|confirm(?:ed|ing|ation)?|reserv(?:ed|ing)?|schedul(?:ed|ing)?)\b/.test(
      text,
    ) ||
    /\b(?:book(?:ed|ing)?|confirm(?:ed|ing|ation)?|reserv(?:ed|ing)?|schedul(?:ed|ing)?)\b.{0,40}\b(?:appointment|slot)\b/.test(
      text,
    ) ||
    /\bappointment\s*id\b/.test(text) ||
    /\btoken\s*(?:number|no\.?|#)\b/.test(text)
  );
};

export const getSafeAppointmentIntakeReply = ({
  action,
  reply,
  intake,
  usesDefaultPrompt,
}) => {
  if (
    usesDefaultPrompt &&
    (action === "ask_details" || action === "intake_complete")
  ) {
    return hasCompleteDefaultIntake(intake)
      ? DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY
      : buildMissingDetailsReply(intake, true);
  }
  if (action === "intake_complete") {
    return !reply || makesRealBookingClaim(reply)
      ? DEFAULT_APPOINTMENT_INTAKE_COMPLETION_REPLY
      : reply;
  }
  if (action === "out_of_scope") {
    return !reply || makesRealBookingClaim(reply)
      ? "I can help only with appointment requests here."
      : reply;
  }
  if (action === "ask_details" && intake.missing_fields?.length) {
    return !reply || makesRealBookingClaim(reply)
      ? buildMissingDetailsReply(intake, usesDefaultPrompt)
      : reply;
  }
  return !reply || makesRealBookingClaim(reply)
    ? buildMissingDetailsReply(intake, usesDefaultPrompt)
    : reply;
};

const normalizeProvidedChatHistory = (conversationHistory = []) =>
  conversationHistory
    .map((entry) => ({
      role:
        entry?.role === "user" || entry?.sender === "user"
          ? "user"
          : "assistant",
      content: normalizeText(entry?.content || entry?.message),
    }))
    .filter((entry) => entry.content);

const isAppointmentIntakeStartMessage = (message = "") => {
  const text = normalizeText(message).toLowerCase();
  return (
    text === "create_appointment" ||
    /^(?:i\s+)?(?:want|need|would like|like)\s+to\s+(?:book|schedule|make)\b.*\b(?:appointment|consultation)\b/.test(
      text,
    ) ||
    /^(?:book|schedule|create|start)\s+(?:an?\s+)?(?:appointment|consultation)\b/.test(
      text,
    )
  );
};

const questionMatchesField = (question, field) => {
  const text = normalizeText(question).toLowerCase();
  const patterns = {
    patient_name: /\b(?:your|patient|full) name\b|\bname\?/,
    email: /\bemail\b/,
    age: /\b(?:age|how old)\b/,
    reason: /\breason\b.*\bvisit\b|\bvisit reason\b/,
    existing_patient: /\bexisting patient\b|\bvisited (?:us|before)\b/,
    preferred_callback_time: /\bcallback\b.*\btime\b|\bpreferred time\b/,
    preferred_language: /\b(?:preferred )?language\b|\blanguage.*prefer\b/,
    city_location: /\b(?:city|location)\b/,
  };
  if (patterns[field.key]?.test(text)) return true;
  const labelTokens = normalizeText(field.label)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
  return labelTokens.length > 0 && labelTokens.every((token) => text.includes(token));
};

const isUsefulIntakeQuestion = (reply, intake = {}) => {
  const nextMissingKey = intake.missing_fields?.[0];
  const nextField = intake.required_fields?.find(
    (field) => field.key === nextMissingKey,
  );
  if (!nextField || !questionMatchesField(reply, nextField)) return false;
  return /\?|\b(?:ask|choose|enter|may i|please|provide|select|share|tell|what|when|where|which|who|are you|do you)\b/i.test(
    normalizeText(reply),
  );
};

export const ensureAppointmentIntakeProgress = ({
  result,
  usesDefaultPrompt = false,
  isStart = false,
} = {}) => {
  if (!result?.intake?.missing_fields?.length) return result;
  if (isUsefulIntakeQuestion(result.reply, result.intake)) return result;

  const question = buildMissingDetailsReply(result.intake, usesDefaultPrompt);
  if (result.action === "answer" && !isStart && normalizeText(result.reply)) {
    return {
      ...result,
      reply: `${normalizeText(result.reply)}\n\n${question}`,
    };
  }
  return { ...result, action: "ask_details", reply: question };
};

export const getAppointmentIntakeLifecycle = ({ action, intake } = {}) => {
  const active = Boolean(intake?.missing_fields?.length);
  return {
    active,
    complete: !active && action === "intake_complete",
  };
};

export const shouldUseAppointmentAiAgent = ({
  appointmentBookingType,
  appointmentIntake,
} = {}) =>
  appointmentIntake?.active === true ||
  appointmentBookingType === APPOINTMENT_BOOKING_TYPES.AI_AGENT;

export const collectAppointmentFieldsFromHistory = (
  requiredFields = [],
  history = [],
) => {
  const fields = normalizeRequiredFields(requiredFields);
  const normalizedHistory = normalizeProvidedChatHistory(history);
  const collected = {};
  let pendingField = null;

  for (const entry of normalizedHistory) {
    if (entry.role === "assistant") {
      pendingField = fields.find((field) =>
        questionMatchesField(entry.content, field),
      );
      continue;
    }
    if (!pendingField || /\?\s*$/.test(entry.content)) continue;
    if (isValidAppointmentIntakeFieldValue(pendingField.key, entry.content)) {
      collected[pendingField.key] = entry.content;
      pendingField = null;
    }
  }
  return collected;
};

export const getCurrentAppointmentIntakeHistory = (history = []) => {
  const normalized = normalizeProvidedChatHistory(history);
  let startIndex = -1;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (
      normalized[index].role === "user" &&
      isAppointmentIntakeStartMessage(normalized[index].content)
    ) {
      startIndex = index;
      break;
    }
  }
  return normalized
    .slice(startIndex >= 0 ? startIndex : 0)
    .slice(-MAX_APPOINTMENT_INTAKE_HISTORY);
};

export const handleAppointmentBookingAiAgent = async ({
  tenantId,
  userPhone,
  contact = null,
  message,
  conversationHistory = [],
}) => {
  const cleanMessage = normalizeText(message);
  const settings = await getAppointmentBookingAutomationSettings(tenantId);
  const requiredFields = deriveAppointmentRequiredFields({
    tenantInstructions: settings.appointment_booking_ai_prompt,
    usesDefaultPrompt:
      settings.uses_default_appointment_booking_ai_prompt === true,
  });

  const [memory, knowledgeResult] = await Promise.all([
    getConversationMemory(tenantId, userPhone, contact?.contact_id).catch(
      () => [],
    ),
    searchKnowledgeChunks(tenantId, cleanMessage).catch(() => ({
      chunks: [],
      resolvedLogs: [],
      sources: [],
    })),
  ]);
  const providedChatHistory = normalizeProvidedChatHistory(conversationHistory);
  const loadedHistory = providedChatHistory.length
    ? providedChatHistory
    : normalizeProvidedChatHistory(memory);
  const historyWithoutCurrentMessage =
    loadedHistory.at(-1)?.role === "user" &&
    loadedHistory.at(-1)?.content === cleanMessage
      ? loadedHistory.slice(0, -1)
      : loadedHistory;
  const isIntakeStart = isAppointmentIntakeStartMessage(cleanMessage);
  const chatHistory = isIntakeStart
    ? []
    : getCurrentAppointmentIntakeHistory(historyWithoutCurrentMessage);
  const previousCollectedFields = collectAppointmentFieldsFromHistory(
    requiredFields,
    [...chatHistory, { role: "user", content: cleanMessage }],
  );

  const aiResult = await callAI({
    messages: [
      {
        role: "system",
        content: buildAppointmentIntakeAgentInstructions({
          tenantInstructions: settings.appointment_booking_ai_prompt,
          usesDefaultPrompt:
            settings.uses_default_appointment_booking_ai_prompt === true,
          requiredFields,
          chatHistory,
          knowledgeChunks: knowledgeResult.chunks || [],
          contact,
        }),
      },
      { role: "user", content: cleanMessage },
    ],
    tenant_id: tenantId,
    source: "appointment_agent",
    temperature: 0,
    responseFormat: { type: "json_object" },
  });

  const usesDefaultPrompt =
    settings.uses_default_appointment_booking_ai_prompt === true;
  const normalized = ensureAppointmentIntakeProgress({
    result: normalizeAppointmentAiResponse(
      safeParseJson(aiResult.content) || {},
      {
        usesDefaultPrompt,
        requiredFields,
        previousCollectedFields,
      },
    ),
    usesDefaultPrompt,
    isStart: isIntakeStart,
  });
  const reply = getSafeAppointmentIntakeReply({
    ...normalized,
    usesDefaultPrompt,
  });
  const lifecycle = getAppointmentIntakeLifecycle(normalized);

  console.log(
    `[AI_APPOINTMENT_INTAKE] tenant=${tenantId} action=${normalized.action} prompt_source=appointment_ai_agent custom_prompt_used=${!settings.uses_default_appointment_booking_ai_prompt} required_fields=${requiredFields.map((field) => field.key).join(",")}`,
  );

  // AI appointment mode is intake-only; real creation stays in the State Machine.
  return makeTextResult(userPhone, reply, {
    appointmentAiAction: normalized.action,
    intake: normalized.intake,
    prompt_source: "appointment_ai_agent",
    custom_prompt_used:
      !settings.uses_default_appointment_booking_ai_prompt,
    appointment_intake: {
      ...lifecycle,
      custom_prompt_used:
        !settings.uses_default_appointment_booking_ai_prompt,
      required_fields: normalized.intake.required_fields.map(
        (field) => field.key,
      ),
      collected_field_keys: Object.keys(normalized.intake.collected_fields),
      missing_fields: normalized.intake.missing_fields,
    },
  });
};
