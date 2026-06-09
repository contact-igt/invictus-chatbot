import {
  APPOINTMENT_REPLY_TYPES,
  decodeAppointmentReply,
} from "./appointmentReplyDecoder.js";

const SMALL_TALK_PHRASES = [
  "hi",
  "hy",
  "hello",
  "hey",
  "thanks",
  "thank you",
  "ok",
  "okay",
  "how are you",
  "good morning",
  "good afternoon",
  "good evening",
];

const QUIT_KEYWORDS = [
  "cancel",
  "stop",
  "exit",
  "quit",
  "leave",
  "no need",
  "not now",
  "cancel appointment",
  "stop booking",
  "end booking",
];

const QUIT_REPLY_IDS = new Set([
  "cancel_appointment",
  "cancel_booking",
  "CANCEL_APPOINTMENT",
  "EXIT_APPOINTMENT",
  "STOP_BOOKING",
]);

const APPOINTMENT_REPLY_PREFIXES = [
  "doctor_",
  "date_",
  "SLOT_",
  "slot_",
  "reason_",
];

const APPOINTMENT_REPLY_IDS = new Set([
  "create_appointment",
  "book_appointment",
  "confirm_booking",
  "edit_details",
  "continue_appointment",
  "edit_name",
  "edit_email",
  "edit_doctor",
  "edit_date",
  "edit_time",
  "edit_reason",
  "back_confirm",
]);

const APPOINTMENT_START_PATTERNS = [
  /\b(book|booking|schedule|scheduled|reserve|make|create|set up|arrange)\b.*\b(appointment|booking|consultation|consult|visit|slot|checkup)\b/i,
  /\b(appointment|booking|consultation|consult|visit|slot|checkup)\b.*\b(book|booking|schedule|reserve|make|create|set up|arrange)\b/i,
  /\b(i want|i need|need|want|would like|looking to)\b.*\b(appointment|consultation|consult|visit|checkup|doctor|dr\.?)\b/i,
  /\b(i want|i need|need|want|would like|looking to)\b.*\b(slots?|time slots?)\b/i,
  /\b(see|meet|consult|visit)\b.*\b(doctor|dr\.?|consultant|physician)\b/i,
  /^(appointment|book appointment|booking|consultation)$/i,
];

const CONTEXTUAL_BOOKING_WINDOW_MS = 10 * 60 * 1000;
const CONTEXTUAL_ASSISTANT_MESSAGE_LIMIT = 3;

const POSITIVE_BOOKING_SHORTCUTS = new Set([
  "yes",
  "y",
  "yeah",
  "yep",
  "ok",
  "okay",
  "sure",
  "proceed",
  "go ahead",
  "yes please",
  "haan",
  "han",
  "ha",
  "ji",
  "confirm",
]);

const BOOKING_OFFER_PATTERNS = [
  /\bwould\s+you\s+like\s+to\s+book\b/i,
  /\bbook\s+a\s+new\s+appointment\b/i,
  /\bschedule\s+an?\s+appointment\b/i,
  /\bcreate\s+a\s+booking\b/i,
  /\bbook\s+a\s+consultation\b/i,
  /\bbook\s+(a\s+)?(demo|session|class|visit)\b/i,
  /\bwould\s+you\s+like\s+to\s+(schedule|create|reserve|make)\b.*\b(appointment|booking|consultation|meeting|demo|session|class|visit)\b/i,
];

const DOCTOR_LIST_REQUEST_PATTERNS = [
  /^(doctor|doctors|dr|drs)$/i,
  /\b(show|list|view|see|available|which|who)\b.*\b(doctors?|drs?)\b/i,
  /\b(doctors?|drs?)\b.*\b(available|availability|list|show|view|see)\b/i,
  /\b(show|check|view|see)\b.*\bdoctor availability\b/i,
  /\bdoctor availability\b/i,
  /\b(doctors?|drs?)\b.*\b(availability|available|slots?|time slots?|timings?|schedule)\b/i,
  /\b(availability|available|slots?|time slots?|timings?|schedule)\b.*\b(doctors?|drs?)\b/i,
  /\b(appointment|booking|consultation|visit)\b.*\b(availability|available|slots?|time slots?)\b/i,
  /\b(availability|available|slots?|time slots?)\b.*\b(appointment|booking|consultation|visit)\b/i,
  /^(availability|available slots?|time slots?|slots?|appointment slots?)$/i,
];

const FACTUAL_QUESTION_PATTERN =
  /\b(what|when|where|which|who|why|how|price|cost|fee|fees|timing|timings|hours|open|close|location|address|service|services)\b/i;
const QUESTION_START_PATTERN = /^(what|when|where|which|who|why|how)\b/i;
const FACTUAL_TOPIC_PATTERN =
  /\b(price|cost|fee|fees|timing|timings|hours|open|close|location|address|service|services)\b/i;

const normalizeText = (value = "") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeShortcutText = (value = "") =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[!?.]+$/g, "");

const isPositiveBookingShortcut = (message = "") =>
  POSITIVE_BOOKING_SHORTCUTS.has(normalizeShortcutText(message));

const isRecentContextMessage = (messageAt, now = Date.now()) => {
  if (!messageAt) return false;
  const timestamp = new Date(messageAt).getTime();
  return Number.isFinite(timestamp) && now - timestamp <= CONTEXTUAL_BOOKING_WINDOW_MS;
};

const hasBookingOfferText = (message = "") =>
  BOOKING_OFFER_PATTERNS.some((pattern) => pattern.test(String(message || "")));

export const isContextualPositiveBookingReply = ({
  message = "",
  chatHistory = [],
  now = Date.now(),
} = {}) => {
  if (!isPositiveBookingShortcut(message)) return false;

  const recentAssistantMessages = [...(Array.isArray(chatHistory) ? chatHistory : [])]
    .reverse()
    .filter((entry) => entry?.role === "assistant")
    .filter((entry) => isRecentContextMessage(entry.message_at, now))
    .slice(0, CONTEXTUAL_ASSISTANT_MESSAGE_LIMIT);

  return recentAssistantMessages.some((entry) => hasBookingOfferText(entry.content));
};

export const hasAppointmentStartSignal = (message = "") => {
  const text = normalizeText(message);
  if (!text || isAppointmentQuitRequest(text)) return false;
  return APPOINTMENT_START_PATTERNS.some((pattern) => pattern.test(text));
};

export const isDoctorListRequest = (message = "") => {
  const text = normalizeText(message);
  if (!text || isAppointmentQuitRequest(text)) {
    return false;
  }
  return DOCTOR_LIST_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
};

export const isPureSmallTalkMessage = (message = "") => {
  const text = normalizeText(message).toLowerCase();
  if (!text || hasAppointmentStartSignal(text)) return false;
  const stripped = text.replace(/[!?.]+$/g, "");
  if (SMALL_TALK_PHRASES.includes(stripped)) return true;
  if (/^(hi|hy|hello|hey|thanks|thank you|ok|okay)([,\s]+(hi|hy|hello|hey|thanks|thank you|ok|okay))*$/.test(stripped)) {
    return true;
  }
  if (/^(hi|hy|hello|hey),?\s+how are you$/.test(stripped)) return true;
  if (/^(hi|hy|hello|hey)\s+(there|team|doctor|dr|sir|madam|mam|ma'am)$/.test(stripped)) {
    return true;
  }
  if (/^(good morning|good afternoon|good evening)\s+(team|doctor|dr|sir|madam|mam|ma'am)$/.test(stripped)) {
    return true;
  }
  return false;
};

export const isGeneralQuestionMessage = (message = "") => {
  const text = normalizeText(message);
  if (!text) return false;
  if (isPureSmallTalkMessage(text)) return true;
  return (
    FACTUAL_QUESTION_PATTERN.test(text) &&
    (text.includes("?") ||
      QUESTION_START_PATTERN.test(text) ||
      FACTUAL_TOPIC_PATTERN.test(text))
  );
};

export const isAppointmentQuitRequest = (message = "", replyId = null) => {
  const rawId = normalizeText(replyId || message);
  if (QUIT_REPLY_IDS.has(rawId)) return true;

  const text = normalizeText(message || replyId).toLowerCase();
  if (!text) return false;
  return QUIT_KEYWORDS.some(
    (keyword) => text === keyword || text.startsWith(`${keyword} `),
  );
};

export const isAppointmentReply = (value = "") => {
  const id = normalizeText(value);
  if (APPOINTMENT_REPLY_IDS.has(id)) return true;
  if (APPOINTMENT_REPLY_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return true;
  }
  const decoded = decodeAppointmentReply(value);
  return decoded.type !== APPOINTMENT_REPLY_TYPES.UNKNOWN;
};

export const getAdvancedAppointmentStartReason = ({
  intent,
  message,
  interactiveReplyId = null,
  chatHistory = [],
} = {}) => {
  if (interactiveReplyId === "create_appointment" || interactiveReplyId === "book_appointment") {
    return "interactive_create_appointment";
  }
  if (intent !== "APPOINTMENT_ACTION") return null;
  if (hasAppointmentStartSignal(message)) return "direct_start_signal";
  if (isContextualPositiveBookingReply({ message, chatHistory })) {
    return "contextual_positive_shortcut";
  }
  if (isPureSmallTalkMessage(message)) return null;
  return null;
};

export const shouldStartAdvancedAppointmentFlow = (args = {}) => {
  return Boolean(getAdvancedAppointmentStartReason(args));
};

const looksLikeNameInput = (message = "") => {
  const text = normalizeText(message);
  if (text.length < 2 || /^\d+$/.test(text)) return false;
  return !isPureSmallTalkMessage(text) && !isGeneralQuestionMessage(text);
};

const looksLikeEmailInput = (message = "") =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeText(message).toLowerCase());

const looksLikeReasonInput = (message = "") => {
  const text = normalizeText(message);
  if (text.length < 2) return false;
  return !isPureSmallTalkMessage(text) && !isGeneralQuestionMessage(text);
};

export const shouldRouteActiveAdvancedAppointmentMessage = ({
  currentState,
  message = "",
  interactiveReplyId = null,
} = {}) => {
  const effectiveValue = interactiveReplyId || message;
  if (isAppointmentQuitRequest(message, interactiveReplyId)) return true;
  if (isAppointmentReply(effectiveValue)) return true;

  if (
    isPureSmallTalkMessage(message) ||
    isGeneralQuestionMessage(message) ||
    isDoctorListRequest(message)
  ) {
    return false;
  }

  switch (currentState) {
    case "COLLECT_NAME":
      return looksLikeNameInput(message);
    case "COLLECT_EMAIL":
      return looksLikeEmailInput(message);
    case "COLLECT_REASON":
    case "EDIT_FIELD":
      return looksLikeReasonInput(message);
    default:
      return false;
  }
};
