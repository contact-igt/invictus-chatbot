import { isPureSmallTalkMessage } from "./appointmentRoutingGuard.service.js";

const MANAGE_START_PATTERNS = [
  /\b(show|view|see|check|manage|details?)\b.*\b(my\s+)?(appointment|appointments|booking|bookings)\b/i,
  /\b(my\s+)?(appointment|appointments|booking|bookings)\b.*\b(show|view|see|check|manage|details?)\b/i,
  /\b(edit|update|change|modify)\b.*\b(my\s+)?(appointment|booking)\b/i,
  /\b(reschedule|re-schedule|postpone|move)\b.*\b(my\s+)?(appointment|booking)\b/i,
  /\b(cancel)\b.*\b(my\s+)?(appointment|booking)\b/i,
  /\b(when|do|have)\b.*\b(my\s+)?(next|upcoming|booked)?\s*(appointment|appointments|booking|bookings)\b/i,
  /^(my appointments|my appointment|appointment details|manage appointment|edit appointment|reschedule appointment|re-schedule appointment|cancel appointment|show booked appointment|view my booking)$/i,
];

const EXACT_EXIT_COMMANDS = new Set([
  "cancel",
  "stop",
  "exit",
  "quit",
  "main menu",
  "back to menu",
]);

export const MANAGE_APPOINTMENT_REPLY_IDS = new Set([
  "manage_appt_book_new",
  "manage_appt_main_menu",
  "manage_appt_edit",
  "manage_appt_reschedule",
  "manage_appt_cancel",
  "manage_appt_edit_name",
  "manage_appt_edit_phone",
  "manage_appt_edit_email",
  "manage_appt_edit_reason",
  "manage_appt_back_details",
  "manage_appt_confirm_reschedule",
  "manage_appt_confirm_cancel",
  "manage_appt_next_page",
  "manage_appt_back_main",
  "view_my_appointments",
]);

const MANAGE_APPOINTMENT_REPLY_PREFIXES = [
  "manage_appt_select_",
  "manage_appt_date_",
  "manage_appt_slot_",
  "manage_appt_slot_group_",
];

const normalizeText = (value = "") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

export const hasManageAppointmentStartSignal = (message = "") => {
  const text = normalizeText(message);
  if (!text || isPureSmallTalkMessage(text)) return false;
  return MANAGE_START_PATTERNS.some((pattern) => pattern.test(text));
};

export const isManageAppointmentReplyId = (replyId = "") => {
  const id = normalizeText(replyId);
  if (!id) return false;
  return (
    MANAGE_APPOINTMENT_REPLY_IDS.has(id) ||
    MANAGE_APPOINTMENT_REPLY_PREFIXES.some((prefix) => id.startsWith(prefix))
  );
};

export const isManageAppointmentExitCommand = (message = "") => {
  const text = normalizeText(message).toLowerCase();
  if (!text || text === "cancel appointment") return false;
  return EXACT_EXIT_COMMANDS.has(text);
};

export const shouldStartManageAppointmentsFlow = ({ intent, message, interactiveReplyId = null } = {}) => {
  if (interactiveReplyId === "view_my_appointments") return true;
  if (isPureSmallTalkMessage(message)) return false;
  return intent === "MANAGE_APPOINTMENTS_ACTION" && hasManageAppointmentStartSignal(message);
};

export const shouldRouteActiveManageAppointmentMessage = ({
  state,
  message = "",
  interactiveReplyId = null,
} = {}) => {
  if (isManageAppointmentExitCommand(message)) return true;
  if (isManageAppointmentReplyId(interactiveReplyId || message)) return true;

  if (state === "AWAITING_EDIT_VALUE") return true;

  return false;
};
