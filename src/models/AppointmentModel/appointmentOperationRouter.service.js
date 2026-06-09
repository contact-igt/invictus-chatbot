import { callAI } from "../../utils/ai/coreAi.js";
import { classifyIntent } from "../../utils/ai/intentClassifier.js";
import { buildChatHistory } from "../../utils/chat/buildChatHistory.js";
import { getConversationMemory } from "../Messages/messages.memory.js";
import {
  APPOINTMENT_MEANING_INTENTS,
  classifyAppointmentMeaning,
} from "./appointmentMeaningClassifier.service.js";
import {
  getActiveAppointmentSession,
  isSessionExpired,
} from "./appointmentSession.service.js";
import {
  getActiveManageAppointmentSession,
  isManageEditInputState,
  isManageAppointmentSessionExpired,
} from "./manageAppointmentSession.service.js";
import { normalizeManagePhone } from "./manageAppointmentLookup.service.js";

export const APPOINTMENT_OPERATION_ROUTES = {
  BOOK_APPOINTMENT: "BOOK_APPOINTMENT",
  MANAGE_APPOINTMENT: "MANAGE_APPOINTMENT",
  POSSIBLE_BOOKING: "POSSIBLE_BOOKING",
  GENERAL_QUESTION: "GENERAL_QUESTION",
};

export const APPOINTMENT_FLOW_TYPES = {
  BOOKING_APPOINTMENT: "BOOKING_APPOINTMENT",
  MANAGE_APPOINTMENT: "MANAGE_APPOINTMENT",
};

export const APPOINTMENT_OPERATION_ACTIONS = {
  BOOK: "book",
  VIEW: "view",
  EDIT: "edit",
  RESCHEDULE: "reschedule",
  CANCEL: "cancel",
  CONFIRM: "confirm",
  ASK_CONFIRMATION: "ask_confirmation",
  REJECT: "reject",
  CONTINUE: "continue",
  EXIT: "exit",
  UNKNOWN: "unknown",
};

export const APPOINTMENT_OPERATION_SOURCES = {
  ACTIVE_SESSION: "active_session",
  INTERACTIVE_REPLY: "interactive_reply",
  PREVIOUS_BOT_CONTEXT: "previous_bot_context",
  DETERMINISTIC_PHRASE: "deterministic_phrase",
  CLASSIFIER_INTENT: "classifier_intent",
  MEANING_CLASSIFIER: "meaning_classifier",
  AI_HELPER: "ai_helper",
  GENERAL: "general",
};

export const PREVIOUS_BOT_CONTEXTS = {
  NONE: "NONE",
  OFFERED_BOOKING: "OFFERED_BOOKING",
  ASKED_BOOKING_NAME: "ASKED_BOOKING_NAME",
  ASKED_BOOKING_EMAIL: "ASKED_BOOKING_EMAIL",
  ASKED_BOOKING_SERVICE: "ASKED_BOOKING_SERVICE",
  ASKED_BOOKING_DOCTOR: "ASKED_BOOKING_DOCTOR",
  ASKED_BOOKING_DATE: "ASKED_BOOKING_DATE",
  ASKED_BOOKING_TIME: "ASKED_BOOKING_TIME",
  ASKED_CONFIRM_BOOKING: "ASKED_CONFIRM_BOOKING",
  ASKED_RESUME_BOOKING: "ASKED_RESUME_BOOKING",
  SHOWED_APPOINTMENT_DETAILS: "SHOWED_APPOINTMENT_DETAILS",
  ASKED_MANAGE_ACTION: "ASKED_MANAGE_ACTION",
  ASKED_CONFIRM_CANCEL: "ASKED_CONFIRM_CANCEL",
  ASKED_CONFIRM_RESCHEDULE: "ASKED_CONFIRM_RESCHEDULE",
};

const ROUTER_MODES = {
  shadow: 0,
  deterministic: 1,
  classifier: 2,
  ai_helper: 3,
  enforce: 4,
};

const DETERMINISTIC_SOURCES = new Set([
  APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION,
  APPOINTMENT_OPERATION_SOURCES.INTERACTIVE_REPLY,
  APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
  APPOINTMENT_OPERATION_SOURCES.DETERMINISTIC_PHRASE,
]);

const BOOKING_REPLY_IDS = new Set([
  "create_appointment",
  "book_appointment",
  "confirm_booking",
  "edit_details",
  "cancel_booking",
  "continue_appointment",
  "edit_name",
  "edit_email",
  "edit_doctor",
  "edit_date",
  "edit_time",
  "edit_reason",
  "back_confirm",
]);

const BOOKING_SESSION_SCOPED_REPLY_IDS = [...BOOKING_REPLY_IDS]
  .filter((id) => id !== "create_appointment")
  .sort((a, b) => b.length - a.length);

const BOOKING_REPLY_PREFIXES = [
  "doctor_",
  "date_",
  "slot_",
  "SLOT_",
  "reason_",
];

const MANAGE_REPLY_IDS = new Set([
  "view_my_appointments",
  "manage_appt_book_new",
  "manage_appt_main_menu",
  "manage_appt_edit",
  "manage_appt_reschedule",
  "manage_appt_cancel",
  "manage_appt_edit_name",
  "manage_appt_edit_phone",
  "manage_appt_edit_email",
  "manage_appt_edit_reason",
  "manage_appt_edit_service",
  "manage_appt_edit_doctor",
  "manage_appt_edit_date",
  "manage_appt_edit_time",
  "manage_appt_back_details",
  "manage_appt_confirm_reschedule",
  "manage_appt_confirm_cancel",
  "manage_appt_next_page",
  "manage_appt_back_main",
  "cancel_appointment",
  "confirm_yes",
  "confirm_no",
]);

const MANAGE_REPLY_PREFIXES = [
  "manage_appt_",
  "appt_",
  "manage_appt_reason_",
  "manage_appt_doctor_",
  "confirm_cancel_",
  "confirm_reschedule_",
  "reschedule_",
];

export const BOOKING_TO_MANAGE_SWITCH_REPLY_IDS = {
  CONFIRM: "appt_switch_confirm_manage",
  CANCEL: "appt_switch_cancel",
};

export const isManageSwitchRequestFromBookingReplyId = (replyId = "") => {
  const id = String(replyId || "").trim();
  return id === "view_my_appointments" || id.startsWith("manage_appt_");
};

export const isBookingToManageSwitchReplyId = (replyId = "") =>
  Object.values(BOOKING_TO_MANAGE_SWITCH_REPLY_IDS).includes(
    String(replyId || "").trim(),
  );

const POSITIVE_SHORT_REPLIES = new Set([
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
  "confirm",
  "haan",
  "han",
  "ha",
  "ji",
]);

const NEGATIVE_SHORT_REPLIES = new Set([
  "no",
  "nope",
  "not now",
  "cancel",
  "stop",
  "back",
  "main menu",
]);

const normalizeText = (value = "") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeShortcut = (value = "") =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[!?.]+$/g, "");

const makeDecision = ({
  shouldHandle = false,
  route = APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION,
  action = APPOINTMENT_OPERATION_ACTIONS.UNKNOWN,
  source = APPOINTMENT_OPERATION_SOURCES.GENERAL,
  confidence = 0,
  reason = "No appointment operation detected.",
  entities = {},
} = {}) => ({
  shouldHandle,
  route,
  action,
  source,
  confidence,
  reason,
  entities,
});

export const normalizeAppointmentOperationInput = ({
  messageText = "",
  buttonReplyId = null,
  messageType = "text",
  rawPayload = null,
} = {}) => {
  const cleanText = normalizeText(messageText);
  const cleanReplyId = buttonReplyId ? normalizeText(buttonReplyId) : null;
  return {
    messageText: cleanText,
    buttonReplyId: cleanReplyId,
    effectiveText: cleanReplyId || cleanText,
    messageType,
    rawPayload,
  };
};

export const getAppointmentOperationRouterMode = () => {
  const mode = String(
    process.env.APPOINTMENT_OPERATION_ROUTER_MODE || "deterministic",
  ).trim();
  return Object.prototype.hasOwnProperty.call(ROUTER_MODES, mode)
    ? mode
    : "deterministic";
};

export const isAppointmentOperationDecisionEnabled = (
  decision,
  mode = getAppointmentOperationRouterMode(),
) => {
  if (!decision?.shouldHandle) return false;
  const level = ROUTER_MODES[mode] ?? ROUTER_MODES.shadow;
  if (level <= ROUTER_MODES.shadow) return false;
  if (DETERMINISTIC_SOURCES.has(decision.source))
    return level >= ROUTER_MODES.deterministic;
  if (decision.source === APPOINTMENT_OPERATION_SOURCES.MEANING_CLASSIFIER) {
    return level >= ROUTER_MODES.deterministic;
  }
  if (decision.source === APPOINTMENT_OPERATION_SOURCES.CLASSIFIER_INTENT) {
    return level >= ROUTER_MODES.classifier;
  }
  if (decision.source === APPOINTMENT_OPERATION_SOURCES.AI_HELPER) {
    return level >= ROUTER_MODES.ai_helper;
  }
  return false;
};

export const isAppointmentOperationSafetyEnabled = (
  mode = getAppointmentOperationRouterMode(),
) => (ROUTER_MODES[mode] ?? ROUTER_MODES.shadow) >= ROUTER_MODES.enforce;

export const isBookingReplyId = (replyId = "") => {
  const id = normalizeText(replyId);
  if (!id) return false;
  if (
    BOOKING_SESSION_SCOPED_REPLY_IDS.some((replyIdBase) =>
      id.startsWith(`${replyIdBase}_`),
    )
  ) {
    return true;
  }
  return (
    BOOKING_REPLY_IDS.has(id) ||
    BOOKING_REPLY_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
};

export const isManageReplyId = (replyId = "") => {
  const id = normalizeText(replyId);
  if (!id) return false;
  if (id === "cancel_booking" || id.startsWith("cancel_booking_")) return false;
  if (id.startsWith("cancel_")) return true;
  return (
    MANAGE_REPLY_IDS.has(id) ||
    MANAGE_REPLY_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
};

const actionFromBookingReplyId = (replyId = "") => {
  const id = normalizeText(replyId);
  const baseId =
    BOOKING_SESSION_SCOPED_REPLY_IDS.find((replyIdBase) =>
      id.startsWith(`${replyIdBase}_`),
    ) || id;
  if (baseId === "confirm_booking")
    return APPOINTMENT_OPERATION_ACTIONS.CONFIRM;
  if (baseId === "cancel_booking") return APPOINTMENT_OPERATION_ACTIONS.REJECT;
  if (baseId === "continue_appointment")
    return APPOINTMENT_OPERATION_ACTIONS.CONTINUE;
  if (baseId === "edit_details" || baseId.startsWith("edit_")) {
    return APPOINTMENT_OPERATION_ACTIONS.EDIT;
  }
  return APPOINTMENT_OPERATION_ACTIONS.BOOK;
};

const actionFromManageReplyId = (replyId = "") => {
  const id = normalizeText(replyId);
  if (id === "view_my_appointments" || id.startsWith("manage_appt_select_")) {
    return APPOINTMENT_OPERATION_ACTIONS.VIEW;
  }
  if (id === "manage_appt_edit" || id.startsWith("manage_appt_edit_")) {
    return APPOINTMENT_OPERATION_ACTIONS.EDIT;
  }
  if (
    id === "manage_appt_reschedule" ||
    id.startsWith("reschedule_") ||
    id.startsWith("manage_appt_date_") ||
    id.startsWith("manage_appt_slot_")
  ) {
    return APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE;
  }
  if (
    id === "manage_appt_cancel" ||
    id === "cancel_appointment" ||
    (id.startsWith("cancel_") && !id.startsWith("cancel_booking")) ||
    id.startsWith("confirm_cancel_")
  ) {
    return APPOINTMENT_OPERATION_ACTIONS.CANCEL;
  }
  if (
    id === "manage_appt_confirm_cancel" ||
    id === "manage_appt_confirm_reschedule" ||
    id === "confirm_yes" ||
    id.startsWith("confirm_reschedule_")
  ) {
    return APPOINTMENT_OPERATION_ACTIONS.CONFIRM;
  }
  if (id === "confirm_no") return APPOINTMENT_OPERATION_ACTIONS.REJECT;
  if (id === "manage_appt_back_main" || id === "manage_appt_main_menu") {
    return APPOINTMENT_OPERATION_ACTIONS.EXIT;
  }
  if (id === "manage_appt_book_new") return APPOINTMENT_OPERATION_ACTIONS.BOOK;
  return APPOINTMENT_OPERATION_ACTIONS.UNKNOWN;
};

export const detectPreviousBotContextFromText = (message = "") => {
  const text = normalizeText(message).toLowerCase();
  if (!text) return PREVIOUS_BOT_CONTEXTS.NONE;

  if (/confirm re-?schedule|do you want to confirm/.test(text)) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_CONFIRM_RESCHEDULE;
  }
  if (/sure you want to cancel|yes,\s*cancel|no,\s*go back/.test(text)) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_CONFIRM_CANCEL;
  }
  if (
    /confirm your appointment booking|please confirm your appointment/.test(
      text,
    )
  ) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_CONFIRM_BOOKING;
  }
  if (/middle of booking|continue your appointment booking/.test(text)) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_RESUME_BOOKING;
  }
  if (
    /your appointment details|patient name:|patient:|edit appointment|update appointments?|re-?schedule|reschedule appt|cancel appointments?/.test(
      text,
    )
  ) {
    return PREVIOUS_BOT_CONTEXTS.SHOWED_APPOINTMENT_DETAILS;
  }
  if (
    /what would you like to edit|appointment menu|please choose an option/.test(
      text,
    )
  ) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_MANAGE_ACTION;
  }
  if (/patient name|what is the.*name|enter the.*name/.test(text)) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_NAME;
  }
  if (/email address|share your email|updated email/.test(text)) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_EMAIL;
  }
  if (
    /select.*services|reason for visit|reason\/service|visit from the list/.test(
      text,
    )
  ) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_SERVICE;
  }
  if (/choose a doctor|view doctors|available doctors/.test(text)) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_DOCTOR;
  }
  if (/choose an appointment date|pick date|available dates/.test(text)) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_DATE;
  }
  if (
    /choose an available time|choose.*time slot|pick time|available time slots/.test(
      text,
    )
  ) {
    return PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_TIME;
  }
  if (
    /would you like to book|book a new appointment|book appointment/.test(text)
  ) {
    return PREVIOUS_BOT_CONTEXTS.OFFERED_BOOKING;
  }

  return PREVIOUS_BOT_CONTEXTS.NONE;
};

const routeFromPreviousBotContext = (context, message = "") => {
  const text = normalizeShortcut(message);
  const positive = POSITIVE_SHORT_REPLIES.has(text);
  const negative = NEGATIVE_SHORT_REPLIES.has(text);
  const edit = /\b(edit|change|modify|update)\b/.test(text);
  const cancel =
    /\b(cancel|cancel it|not coming|can't come|cannot come|wont come|won't come)\b/.test(
      text,
    );
  const reschedule =
    /\b(reschedule|re schedule|move|shift|change time|tomorrow|evening|morning|afternoon)\b/.test(
      text,
    );

  if (context === PREVIOUS_BOT_CONTEXTS.OFFERED_BOOKING && positive) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      action: APPOINTMENT_OPERATION_ACTIONS.BOOK,
      source: APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
      confidence: 0.91,
      reason: "Previous bot message offered booking and user accepted.",
    });
  }

  if (
    [
      PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_NAME,
      PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_EMAIL,
      PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_SERVICE,
      PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_DOCTOR,
      PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_DATE,
      PREVIOUS_BOT_CONTEXTS.ASKED_BOOKING_TIME,
      PREVIOUS_BOT_CONTEXTS.ASKED_CONFIRM_BOOKING,
      PREVIOUS_BOT_CONTEXTS.ASKED_RESUME_BOOKING,
    ].includes(context)
  ) {
    if (negative && context === PREVIOUS_BOT_CONTEXTS.ASKED_CONFIRM_BOOKING) {
      return makeDecision({
        shouldHandle: true,
        route: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
        action: APPOINTMENT_OPERATION_ACTIONS.REJECT,
        source: APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
        confidence: 0.86,
        reason: "User rejected booking confirmation in booking context.",
      });
    }
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      action: positive
        ? APPOINTMENT_OPERATION_ACTIONS.CONFIRM
        : APPOINTMENT_OPERATION_ACTIONS.BOOK,
      source: APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
      confidence: 0.88,
      reason: `User replied inside ${context} context.`,
    });
  }

  if (
    context === PREVIOUS_BOT_CONTEXTS.SHOWED_APPOINTMENT_DETAILS ||
    context === PREVIOUS_BOT_CONTEXTS.ASKED_MANAGE_ACTION
  ) {
    if (edit) {
      return makeDecision({
        shouldHandle: true,
        route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
        action: APPOINTMENT_OPERATION_ACTIONS.EDIT,
        source: APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
        confidence: 0.9,
        reason: "User requested edit after appointment details/menu.",
      });
    }
    if (cancel) {
      return makeDecision({
        shouldHandle: true,
        route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
        action: APPOINTMENT_OPERATION_ACTIONS.CANCEL,
        source: APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
        confidence: 0.9,
        reason: "User requested cancel after appointment details/menu.",
      });
    }
    if (reschedule) {
      return makeDecision({
        shouldHandle: true,
        route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
        action: APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE,
        source: APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
        confidence: 0.88,
        reason: "User requested reschedule after appointment details/menu.",
      });
    }
  }

  if (
    context === PREVIOUS_BOT_CONTEXTS.ASKED_CONFIRM_CANCEL &&
    (positive || negative)
  ) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      action: positive
        ? APPOINTMENT_OPERATION_ACTIONS.CONFIRM
        : APPOINTMENT_OPERATION_ACTIONS.REJECT,
      source: APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
      confidence: 0.9,
      reason: "User replied to cancel confirmation.",
    });
  }

  if (
    context === PREVIOUS_BOT_CONTEXTS.ASKED_CONFIRM_RESCHEDULE &&
    (positive || negative)
  ) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      action: positive
        ? APPOINTMENT_OPERATION_ACTIONS.CONFIRM
        : APPOINTMENT_OPERATION_ACTIONS.REJECT,
      source: APPOINTMENT_OPERATION_SOURCES.PREVIOUS_BOT_CONTEXT,
      confidence: 0.9,
      reason: "User replied to reschedule confirmation.",
    });
  }

  return null;
};

export const routeFromDeterministicPhrase = (message = "") => {
  const text = normalizeShortcut(message);
  if (!text) return null;

  const manageActionPatterns = [
    {
      action: APPOINTMENT_OPERATION_ACTIONS.EDIT,
      pattern: /\b(edit|change|modify|update)\b.*\b(appointment|booking)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE,
      pattern:
        /\b(reschedule|re schedule|re-schedule|move|postpone)\b.*\b(appointment|booking|it)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE,
      pattern:
        /\b(i want|i need|need|want|would like|please|can i|help me)\b.*\b(reschedule|re schedule|re-schedule|postpone|move)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE,
      pattern:
        /\b(change time|change doctor|shift it|shift appointment|move it)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.EDIT,
      pattern:
        /\b(i want|i need|need|want|would like|please|can i|help me)\b.*\b(edit|update|modify|change)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.CANCEL,
      pattern: /\b(cancel|delete)\b.*\b(appointment|booking)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.CANCEL,
      pattern:
        /\b(i want|i need|need|want|would like|please|can i|help me)\b.*\b(cancel|delete)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.CANCEL,
      pattern: /\b(not coming|can't come|cannot come|wont come|won't come)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.VIEW,
      pattern:
        /\b(show|view|see|check)\b.*\b(my\s+)?(appointment|appointments|booking|bookings)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.VIEW,
      pattern: /\b(appointment status|booking status)\b/,
    },
    {
      action: APPOINTMENT_OPERATION_ACTIONS.VIEW,
      pattern:
        /\b(my appointment|my appointments|my booking|my bookings|appointment details)\b/,
    },
  ];

  for (const candidate of manageActionPatterns) {
    if (candidate.pattern.test(text)) {
      return makeDecision({
        shouldHandle: true,
        route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
        action: candidate.action,
        source: APPOINTMENT_OPERATION_SOURCES.DETERMINISTIC_PHRASE,
        confidence: 0.88,
        reason: "Matched deterministic manage appointment phrase.",
      });
    }
  }

  if (/\bdoctor\b.*\b(paakanum|pakkanum)\b/.test(text)) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      action: APPOINTMENT_OPERATION_ACTIONS.BOOK,
      source: APPOINTMENT_OPERATION_SOURCES.DETERMINISTIC_PHRASE,
      confidence: 0.87,
      reason: "Matched deterministic booking phrase.",
    });
  }

  const bookingPattern =
    /^(book|appointment|book appointment|schedule appointment|need appointment|want appointment|doctor appointment|consultation booking|consultation book|book consultation|need doctor|meet doctor|create appointment|appointment venum|appointment vendum|doctor ah pakkanum|doctor pakkanum|appointment book panna|appointment book பண்ணணும்|appointment book பண்ண|book appointment please)$/i;
  const bookingSentencePattern =
    /\b(book|schedule|create|need|want|start|make)\b.*\b(appointment|consultation|doctor|slot|booking|visit)\b|\b(meet|see|visit)\b.*\b(doctor|dr\.?)\b|\b(appointment|consultation)\b.*\b(venum|vendum|pakkanum|pann(?:a|u|ணும்)?)/i;

  if (bookingPattern.test(text) || bookingSentencePattern.test(text)) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      action: APPOINTMENT_OPERATION_ACTIONS.BOOK,
      source: APPOINTMENT_OPERATION_SOURCES.DETERMINISTIC_PHRASE,
      confidence: 0.87,
      reason: "Matched deterministic booking phrase.",
    });
  }

  return null;
};

const routeFromReplyId = (replyId = "") => {
  const id = normalizeText(replyId);
  if (!id) return null;
  if (isManageReplyId(id)) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      action: actionFromManageReplyId(id),
      source: APPOINTMENT_OPERATION_SOURCES.INTERACTIVE_REPLY,
      confidence: 1,
      reason: "Matched WhatsApp manage appointment reply id.",
      entities: { replyId: id },
    });
  }
  if (isBookingReplyId(id)) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      action: actionFromBookingReplyId(id),
      source: APPOINTMENT_OPERATION_SOURCES.INTERACTIVE_REPLY,
      confidence: 1,
      reason: "Matched WhatsApp booking reply id.",
      entities: { replyId: id },
    });
  }
  return null;
};

const flowTypeFromRoute = (route) => {
  if (route === APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT) {
    return APPOINTMENT_FLOW_TYPES.BOOKING_APPOINTMENT;
  }
  if (route === APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT) {
    return APPOINTMENT_FLOW_TYPES.MANAGE_APPOINTMENT;
  }
  return null;
};

export const detectAppointmentIncomingFlowType = (normalizedMessage) => {
  const input = normalizeAppointmentOperationInput(normalizedMessage);
  const replyDecision = routeFromReplyId(input.buttonReplyId);
  if (replyDecision?.shouldHandle)
    return flowTypeFromRoute(replyDecision.route);

  const phraseDecision = routeFromDeterministicPhrase(input.messageText);
  if (phraseDecision?.shouldHandle)
    return flowTypeFromRoute(phraseDecision.route);

  return null;
};

const looksAppointmentLike = (message = "") =>
  /\b(appointment|booking|book|doctor|consultation|slot|reschedule|re schedule|cancel|edit|change time|change doctor|not coming|can't come|cannot come|move it|shift it)\b/i.test(
    message,
  );

const normalizeAiHelperDecision = (raw = {}) => {
  const route = Object.values(APPOINTMENT_OPERATION_ROUTES).includes(raw.route)
    ? raw.route
    : APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION;
  const action = Object.values(APPOINTMENT_OPERATION_ACTIONS).includes(
    raw.action,
  )
    ? raw.action
    : APPOINTMENT_OPERATION_ACTIONS.UNKNOWN;
  const confidence = Number.isFinite(Number(raw.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0;
  return makeDecision({
    shouldHandle: route !== APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION,
    route,
    action,
    source: APPOINTMENT_OPERATION_SOURCES.AI_HELPER,
    confidence,
    reason:
      normalizeText(raw.reason) ||
      "AI helper classified appointment operation.",
    entities:
      raw.entities && typeof raw.entities === "object" ? raw.entities : {},
  });
};

const normalizeMeaningClassifierDecision = (raw = {}) => {
  const intent = raw?.intent || APPOINTMENT_MEANING_INTENTS.UNKNOWN;
  const confidence = Number.isFinite(Number(raw?.confidence))
    ? Math.max(0, Math.min(1, Number(raw.confidence)))
    : 0;
  const language = normalizeText(raw?.language) || "unknown";
  const subIntent = normalizeText(raw?.sub_intent) || null;
  const reason =
    normalizeText(raw?.reason) || "Appointment meaning classifier ran.";
  const subIntentToAction = {
    RESCHEDULE_APPOINTMENT: APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE,
    CANCEL_APPOINTMENT: APPOINTMENT_OPERATION_ACTIONS.CANCEL,
    VIEW_APPOINTMENT: APPOINTMENT_OPERATION_ACTIONS.VIEW,
    CHANGE_APPOINTMENT: APPOINTMENT_OPERATION_ACTIONS.EDIT,
    ASK_CONFIRMATION: APPOINTMENT_OPERATION_ACTIONS.ASK_CONFIRMATION,
  };
  const entities = {
    language,
    subIntent,
    meaningConfidence: confidence,
  };

  if (
    intent === APPOINTMENT_MEANING_INTENTS.BOOK_APPOINTMENT &&
    confidence >= 0.8
  ) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      action: APPOINTMENT_OPERATION_ACTIONS.BOOK,
      source: APPOINTMENT_OPERATION_SOURCES.MEANING_CLASSIFIER,
      confidence,
      reason,
      entities,
    });
  }

  if (
    intent === APPOINTMENT_MEANING_INTENTS.MANAGE_APPOINTMENT &&
    confidence >= 0.8
  ) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      action:
        subIntentToAction[subIntent] || APPOINTMENT_OPERATION_ACTIONS.UNKNOWN,
      source: APPOINTMENT_OPERATION_SOURCES.MEANING_CLASSIFIER,
      confidence,
      reason,
      entities,
    });
  }

  if (
    intent === APPOINTMENT_MEANING_INTENTS.POSSIBLE_BOOKING &&
    confidence >= 0.55
  ) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.POSSIBLE_BOOKING,
      action: APPOINTMENT_OPERATION_ACTIONS.ASK_CONFIRMATION,
      source: APPOINTMENT_OPERATION_SOURCES.MEANING_CLASSIFIER,
      confidence,
      reason,
      entities,
    });
  }

  return makeDecision({
    shouldHandle: false,
    route: APPOINTMENT_OPERATION_ROUTES.GENERAL_QUESTION,
    action: APPOINTMENT_OPERATION_ACTIONS.UNKNOWN,
    source: APPOINTMENT_OPERATION_SOURCES.MEANING_CLASSIFIER,
    confidence,
    reason,
    entities,
  });
};

const runAiHelper = async ({ message, tenantId, previousBotContext }) => {
  const prompt = `Classify this WhatsApp message for appointment routing only. Do not write a customer reply.

Previous bot context: ${previousBotContext || PREVIOUS_BOT_CONTEXTS.NONE}
Customer message: "${message}"

Return only JSON:
{
  "route": "BOOK_APPOINTMENT" | "MANAGE_APPOINTMENT" | "GENERAL_QUESTION",
  "action": "book" | "view" | "edit" | "reschedule" | "cancel" | "confirm" | "reject" | "continue" | "exit" | "unknown",
  "confidence": 0.0,
  "entities": {},
  "reason": ""
}`;

  const helperCall = callAI({
    messages: [{ role: "system", content: prompt }],
    tenant_id: tenantId,
    source: "classifier",
    temperature: 0,
    responseFormat: { type: "json_object" },
    maxTokens: 180,
  });

  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("AI helper timeout")), 2500);
  });

  const result = await Promise.race([helperCall, timeout]);
  return normalizeAiHelperDecision(JSON.parse(result.content || "{}"));
};

export const getPreviousBotContext = async ({ tenantId, phone, contactId }) => {
  const memory = await getConversationMemory(tenantId, phone, contactId).catch(
    () => [],
  );
  const chatHistory = buildChatHistory(memory);
  const previousBotMessage = [...chatHistory]
    .reverse()
    .find(
      (entry) => entry.role === "assistant" && normalizeText(entry.content),
    );
  return {
    previousBotContext: detectPreviousBotContextFromText(
      previousBotMessage?.content || "",
    ),
    chatHistory,
  };
};

export const resolveAppointmentOperationDecision = ({
  normalizedMessage,
  previousBotContext = PREVIOUS_BOT_CONTEXTS.NONE,
  meaningClassifierResult = null,
  activeBookingSession = null,
  activeManageSession = null,
} = {}) => {
  const input = normalizeAppointmentOperationInput(normalizedMessage);

  if (
    activeManageSession &&
    isManageEditInputState(activeManageSession.state)
  ) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      action: APPOINTMENT_OPERATION_ACTIONS.EDIT,
      source: APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION,
      confidence: 1,
      reason: `Active manage appointment edit session is in state ${activeManageSession.state}.`,
      entities: {
        sessionId: activeManageSession.session_id,
        state: activeManageSession.state,
      },
    });
  }

  if (
    activeManageSession &&
    input.buttonReplyId &&
    input.buttonReplyId !== "create_appointment" &&
    isBookingReplyId(input.buttonReplyId)
  ) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      action: APPOINTMENT_OPERATION_ACTIONS.EDIT,
      source: APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION,
      confidence: 1,
      reason: `Active manage appointment session owns legacy booking-style reply ${input.buttonReplyId}.`,
      entities: {
        sessionId: activeManageSession.session_id,
        state: activeManageSession.state,
        replyId: input.buttonReplyId,
      },
    });
  }

  const replyDecision = routeFromReplyId(input.buttonReplyId);
  if (replyDecision) return replyDecision;

  const phraseDecision = routeFromDeterministicPhrase(input.messageText);
  const phraseFlowType = flowTypeFromRoute(phraseDecision?.route);
  const activeManageFlowType = activeManageSession
    ? APPOINTMENT_FLOW_TYPES.MANAGE_APPOINTMENT
    : null;
  const activeBookingFlowType = activeBookingSession
    ? APPOINTMENT_FLOW_TYPES.BOOKING_APPOINTMENT
    : null;
  const activeFlowType = activeManageFlowType || activeBookingFlowType;

  if (
    phraseDecision &&
    (!activeFlowType || phraseFlowType !== activeFlowType)
  ) {
    return phraseDecision;
  }

  if (activeManageSession) {
    const contextualManageDecision =
      routeFromPreviousBotContext(previousBotContext, input.messageText) ||
      phraseDecision;
    const action =
      contextualManageDecision?.action || APPOINTMENT_OPERATION_ACTIONS.UNKNOWN;
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
      action,
      source: APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION,
      confidence: 1,
      reason: contextualManageDecision?.reason
        ? `Active manage appointment session is in state ${activeManageSession.state}; ${contextualManageDecision.reason}`
        : `Active manage appointment session is in state ${activeManageSession.state}.`,
      entities: {
        sessionId: activeManageSession.session_id,
        state: activeManageSession.state,
      },
    });
  }

  if (activeBookingSession) {
    return makeDecision({
      shouldHandle: true,
      route: APPOINTMENT_OPERATION_ROUTES.BOOK_APPOINTMENT,
      action: APPOINTMENT_OPERATION_ACTIONS.BOOK,
      source: APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION,
      confidence: 1,
      reason: `Active booking session is in step ${activeBookingSession.current_step}.`,
      entities: {
        sessionId: activeBookingSession.session_id,
        step: activeBookingSession.current_step,
      },
    });
  }

  const contextDecision = routeFromPreviousBotContext(
    previousBotContext,
    input.messageText,
  );
  if (contextDecision) return contextDecision;

  if (phraseDecision) return phraseDecision;

  if (meaningClassifierResult) {
    const meaningDecision = normalizeMeaningClassifierDecision(
      meaningClassifierResult,
    );
    if (meaningDecision.shouldHandle) return meaningDecision;
  }

  return makeDecision();
};

export const routeAppointmentOperation = async ({
  tenantId,
  phone,
  contactId = null,
  normalizedMessage,
  classifierResult = null,
  skipAiHelper = false,
  languageContext = null,
} = {}) => {
  const input = normalizeAppointmentOperationInput(normalizedMessage);
  const normalizedManagePhone = normalizeManagePhone(phone);
  
  const [activeManageSession, activeBookingSession, previousContextResult] =
    await Promise.all([
      normalizedManagePhone
        ? getActiveManageAppointmentSession({
            tenantId,
            userPhone: normalizedManagePhone,
          }).catch(() => null)
        : null,
      getActiveAppointmentSession({
        tenantId,
        contactId,
        userPhone: phone,
      }).catch(() => null),
      getPreviousBotContext({ tenantId, phone, contactId }).catch(() => ({
        previousBotContext: PREVIOUS_BOT_CONTEXTS.NONE,
        chatHistory: [],
      })),
    ]);
  const validActiveManageSession =
    activeManageSession &&
    !isManageAppointmentSessionExpired(activeManageSession)
      ? activeManageSession
      : null;
  const validActiveBookingSession =
    activeBookingSession && !isSessionExpired(activeBookingSession)
      ? activeBookingSession
      : null;

  let decision = resolveAppointmentOperationDecision({
    normalizedMessage: input,
    previousBotContext: previousContextResult.previousBotContext,
    activeManageSession: validActiveManageSession,
    activeBookingSession: validActiveBookingSession,
  });
  

  let meaningClassifierResult = null;
  if (!decision.shouldHandle) {
    meaningClassifierResult = await classifyAppointmentMeaning({
      tenantId,
      messageText: input.messageText,
      normalizedMessage: input.effectiveText,
      previousBotContext: previousContextResult.previousBotContext,
      chatHistory: previousContextResult.chatHistory || [],
      activeBookingSession: validActiveBookingSession,
      activeManageSession: validActiveManageSession,
      buttonReplyId: input.buttonReplyId,
      detectedLanguage: languageContext, // Pass full languageContext object
    }).catch((err) => {
      console.error(
        "[APPOINTMENT_OPERATION_ROUTER] meaning classifier error:",
        err.message,
      );
      return null;
    });
    if (meaningClassifierResult) {
      
      decision = resolveAppointmentOperationDecision({
        normalizedMessage: input,
        previousBotContext: previousContextResult.previousBotContext,
        meaningClassifierResult,
        activeManageSession: validActiveManageSession,
        activeBookingSession: validActiveBookingSession,
      });
      
    }
  }

  let resolvedClassifier = classifierResult;
  if (!resolvedClassifier && !decision.shouldHandle) {
    const isSmallTalk = /^(hi|hello|hey|thanks|thank you|ok|okay|bye)$/i.test(
      input.messageText,
    );
    resolvedClassifier = isSmallTalk
      ? {
          intent: "GENERAL_QUESTION",
          requires: { knowledge: false, doctors: false, appointments: false },
          lead_intelligence: null,
        }
      : await classifyIntent(
          input.messageText,
          previousContextResult.chatHistory || [],
          tenantId,
        ).catch(() => null);
  }

  if (
    !decision.shouldHandle &&
    !skipAiHelper &&
    looksAppointmentLike(input.messageText)
  ) {
    
    decision = await runAiHelper({
      message: input.messageText,
      tenantId,
      previousBotContext: previousContextResult.previousBotContext,
    }).catch(() => {
      const fallback = routeFromDeterministicPhrase(input.messageText);
      return (
        fallback ||
        makeDecision({
          shouldHandle: true,
          route: APPOINTMENT_OPERATION_ROUTES.MANAGE_APPOINTMENT,
          action: APPOINTMENT_OPERATION_ACTIONS.UNKNOWN,
          source: APPOINTMENT_OPERATION_SOURCES.AI_HELPER,
          confidence: 0.55,
          reason:
            "AI helper failed; appointment-like text routed to safe manage lookup.",
        })
      );
    });
  }

  

  return {
    decision: decision || makeDecision(),
    classifierResult: resolvedClassifier,
    meaningClassifierResult,
    previousBotContext: previousContextResult.previousBotContext,
    activeBookingSession: validActiveBookingSession,
    activeManageSession: validActiveManageSession,
  };
};

export const canonicalizeManageOperationMessage = ({
  decision,
  normalizedMessage,
} = {}) => {
  const input = normalizeAppointmentOperationInput(normalizedMessage);
  if (input.buttonReplyId) return input.messageText;
  if (
    decision?.source === APPOINTMENT_OPERATION_SOURCES.ACTIVE_SESSION &&
    isManageEditInputState(decision?.entities?.state)
  ) {
    return input.messageText;
  }
  if (decision?.source === APPOINTMENT_OPERATION_SOURCES.INTERACTIVE_REPLY) {
    return input.messageText;
  }
  switch (decision?.action) {
    case APPOINTMENT_OPERATION_ACTIONS.BOOK:
      return "manage_appt_book_new";
    case APPOINTMENT_OPERATION_ACTIONS.EDIT:
      return "manage_appt_edit";
    case APPOINTMENT_OPERATION_ACTIONS.RESCHEDULE:
      return "manage_appt_reschedule";
    case APPOINTMENT_OPERATION_ACTIONS.CANCEL:
      return "manage_appt_cancel";
    case APPOINTMENT_OPERATION_ACTIONS.CONFIRM:
      if (decision?.reason?.toLowerCase().includes("cancel")) {
        return "manage_appt_confirm_cancel";
      }
      if (decision?.reason?.toLowerCase().includes("reschedule")) {
        return "manage_appt_confirm_reschedule";
      }
      return input.effectiveText;
    case APPOINTMENT_OPERATION_ACTIONS.REJECT:
    case APPOINTMENT_OPERATION_ACTIONS.EXIT:
      return "manage_appt_back_details";
    default:
      return input.messageText;
  }
};

export const logAppointmentOperationRouterDecision = ({
  tenantId,
  phone,
  normalizedMessage,
  routingResult,
  mode = getAppointmentOperationRouterMode(),
} = {}) => {
  const input = normalizeAppointmentOperationInput(normalizedMessage);
  const decision = routingResult?.decision || makeDecision();
  const payload = {
    tenantId,
    phone,
    messageText: input.messageText,
    buttonReplyId: input.buttonReplyId,
    effectiveText: input.effectiveText,
    activeBookingSession: Boolean(routingResult?.activeBookingSession),
    activeManageSession: Boolean(routingResult?.activeManageSession),
    previousBotContext:
      routingResult?.previousBotContext || PREVIOUS_BOT_CONTEXTS.NONE,
    classifierIntent: routingResult?.classifierResult?.intent || null,
    meaningIntent: routingResult?.meaningClassifierResult?.intent || null,
    finalRoute: decision.route,
    action: decision.action,
    source: decision.source,
    confidence: decision.confidence,
    reason: decision.reason,
    shouldCallNormalAI: !isAppointmentOperationDecisionEnabled(decision, mode),
    mode,
  };
  
};
