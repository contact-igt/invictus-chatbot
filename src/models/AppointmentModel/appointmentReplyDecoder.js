export const APPOINTMENT_REPLY_TYPES = {
  DOCTOR_SELECTED: "DOCTOR_SELECTED",
  DATE_SELECTED: "DATE_SELECTED",
  SLOT_GROUP_SELECTED: "SLOT_GROUP_SELECTED",
  TIME_SELECTED: "TIME_SELECTED",
  REASON_SELECTED: "REASON_SELECTED",
  CONFIRM_BOOKING: "CONFIRM_BOOKING",
  EDIT_DETAILS: "EDIT_DETAILS",
  CANCEL_BOOKING: "CANCEL_BOOKING",
  CONTINUE_APPOINTMENT: "CONTINUE_APPOINTMENT",
  EDIT_NAME: "EDIT_NAME",
  EDIT_EMAIL: "EDIT_EMAIL",
  EDIT_DOCTOR: "EDIT_DOCTOR",
  EDIT_DATE: "EDIT_DATE",
  EDIT_TIME: "EDIT_TIME",
  EDIT_REASON: "EDIT_REASON",
  BACK_TO_CONFIRM: "BACK_TO_CONFIRM",
  UNKNOWN: "UNKNOWN",
};

const STATIC_REPLY_MAP = {
  confirm_booking: APPOINTMENT_REPLY_TYPES.CONFIRM_BOOKING,
  edit_details: APPOINTMENT_REPLY_TYPES.EDIT_DETAILS,
  cancel_booking: APPOINTMENT_REPLY_TYPES.CANCEL_BOOKING,
  cancel_appointment: APPOINTMENT_REPLY_TYPES.CANCEL_BOOKING,
  continue_appointment: APPOINTMENT_REPLY_TYPES.CONTINUE_APPOINTMENT,
  edit_name: APPOINTMENT_REPLY_TYPES.EDIT_NAME,
  edit_email: APPOINTMENT_REPLY_TYPES.EDIT_EMAIL,
  edit_doctor: APPOINTMENT_REPLY_TYPES.EDIT_DOCTOR,
  edit_date: APPOINTMENT_REPLY_TYPES.EDIT_DATE,
  edit_time: APPOINTMENT_REPLY_TYPES.EDIT_TIME,
  edit_reason: APPOINTMENT_REPLY_TYPES.EDIT_REASON,
  back_confirm: APPOINTMENT_REPLY_TYPES.BACK_TO_CONFIRM,
};

export const encodeSlotTime = (time) =>
  String(time || "")
    .replace(/^(\d):/, "0$1:")
    .replace(/:/g, "-")
    .replace(/\s+/g, "-")
    .toUpperCase();

export const decodeSlotTime = (encoded) => {
  const raw = String(encoded || "").trim().toUpperCase();
  const match = raw.match(/^(\d{1,2})-(\d{2})-([AP]M)$/);
  if (!match) return null;
  const [, h, m, p] = match;
  return `${h.padStart(2, "0")}:${m} ${p}`;
};

export const decodeAppointmentReply = (replyId) => {
  const id = String(replyId || "").trim();
  if (!id) return { type: APPOINTMENT_REPLY_TYPES.UNKNOWN };

  if (id.startsWith("doctor_")) {
    const value = id.slice("doctor_".length);
    return value
      ? { type: APPOINTMENT_REPLY_TYPES.DOCTOR_SELECTED, value }
      : { type: APPOINTMENT_REPLY_TYPES.UNKNOWN };
  }

  if (id.startsWith("date_")) {
    const value = id.slice("date_".length);
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? { type: APPOINTMENT_REPLY_TYPES.DATE_SELECTED, value }
      : { type: APPOINTMENT_REPLY_TYPES.UNKNOWN };
  }

  if (/^SLOT_GROUP_[1-4]$/.test(id)) {
    return { type: APPOINTMENT_REPLY_TYPES.SLOT_GROUP_SELECTED, value: id };
  }

  if (id.startsWith("SLOT_")) {
    const value = decodeSlotTime(id.slice("SLOT_".length).replace(/_/g, "-"));
    return value
      ? { type: APPOINTMENT_REPLY_TYPES.TIME_SELECTED, value }
      : { type: APPOINTMENT_REPLY_TYPES.UNKNOWN };
  }

  if (id.startsWith("slot_")) {
    const value = decodeSlotTime(id.slice("slot_".length));
    return value
      ? { type: APPOINTMENT_REPLY_TYPES.TIME_SELECTED, value }
      : { type: APPOINTMENT_REPLY_TYPES.UNKNOWN };
  }

  if (id.startsWith("reason_")) {
    const value = id.slice("reason_".length);
    return value
      ? { type: APPOINTMENT_REPLY_TYPES.REASON_SELECTED, value }
      : { type: APPOINTMENT_REPLY_TYPES.UNKNOWN };
  }

  const mapped = STATIC_REPLY_MAP[id];
  return mapped
    ? { type: mapped }
    : { type: APPOINTMENT_REPLY_TYPES.UNKNOWN };
};
