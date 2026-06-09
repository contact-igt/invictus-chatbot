import db from "../../database/index.js";
import { Op } from "sequelize";
import { getIO } from "../../middlewares/socket/socket.js";
import { tableNames } from "../../database/tableName.js";
import { callAI } from "../../utils/ai/coreAi.js";
import { getDomainSummary } from "../../utils/ai/domainContextHelper.js";
import { getDoctorListService } from "../DoctorModel/doctor.service.js";
import {
  checkAvailabilityService,
  createAppointmentService,
  getAvailableSlotsService,
} from "./appointment.service.js";
import {
  APPOINTMENT_REPLY_TYPES,
  decodeAppointmentReply,
} from "./appointmentReplyDecoder.js";
import {
  buildAppointmentResumeCancelPayload,
  buildBookingSessionExpiredPayload,
  buildConfirmPayload,
  buildDateListPayload,
  buildDoctorListPayload,
  buildEditMenuPayload,
  buildQuitPayload,
  buildReasonServiceListPayload,
  buildSuccessPayload,
  buildTextPayload,
  buildTimeSlotPayload,
} from "./whatsappAppointmentTemplates.service.js";
import {
  ADVANCED_SESSION_STATUS,
  cancelAppointmentSession,
  completeAppointmentSession,
  expireAppointmentSession,
  getActiveAppointmentSession,
  getOrCreateAppointmentSession,
  getSessionDraft,
  isSessionExpired,
  transitionAppointmentState,
  updateAppointmentDraft,
} from "./appointmentSession.service.js";
import {
  isSlotLockedBySessionOrAvailable,
  lockAppointmentSlot,
  markSlotBooked,
  releaseLockedSlots,
} from "./appointmentSlotLock.service.js";
import {
  buildSlotSelectionContext,
  getSlotSelectionRows,
  resolveSlotSelection,
} from "./appointmentSlotGrouping.service.js";
import {
  hasProcessedAppointmentMessage,
  logAppointmentStateTransition,
} from "./appointmentStateLog.service.js";
import { isAppointmentQuitRequest } from "./appointmentRoutingGuard.service.js";
import { buildStaleBookingManagePromptPayload } from "./manageAppointmentTemplates.service.js";

export const APPOINTMENT_STATES = {
  COLLECT_NAME: "COLLECT_NAME",
  COLLECT_EMAIL: "COLLECT_EMAIL",
  SELECT_DOCTOR: "SELECT_DOCTOR",
  SELECT_DATE: "SELECT_DATE",
  SELECT_TIME: "SELECT_TIME",
  COLLECT_REASON: "COLLECT_REASON",
  CONFIRM_BOOKING: "CONFIRM_BOOKING",
  EDIT_MENU: "EDIT_MENU",
  EDIT_FIELD: "EDIT_FIELD",
  BOOKING_COMPLETE: "BOOKING_COMPLETE",
  AWAITING_RESUME_DECISION: "AWAITING_RESUME_DECISION",
};

const CANCEL_KEYWORDS = [
  "cancel",
  "stop",
  "exit",
  "quit",
  "leave",
  "leave it",
  "not interested",
  "no need",
  "not now",
  "cancel appointment",
  "stop booking",
  "end booking",
];

const EDIT_KEYWORDS = [
  "edit",
  "edit details",
  "change",
  "change details",
  "modify",
  "back",
];

const REASON_SOURCE = {
  SERVICE_MENU: "SERVICE_MENU",
  MANUAL_TEXT: "MANUAL_TEXT",
};

const DOCTOR_LIST_MODE = {
  FILTERED_BY_SPECIALIZATION: "FILTERED_BY_SPECIALIZATION",
  GENERAL_DOCTOR_FALLBACK: "GENERAL_DOCTOR_FALLBACK",
  ALL_ACTIVE_DOCTORS: "ALL_ACTIVE_DOCTORS",
};

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const toDateOnly = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const getDayOfWeek = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  return DAY_NAMES[d.getDay()];
};

const isPastDate = (dateStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return target < today;
};

const isCancelKeyword = (message = "", replyId = null) => {
  if (isAppointmentQuitRequest(message, replyId)) return true;
  const normalized = String(message || "").trim().toLowerCase();
  return CANCEL_KEYWORDS.some((kw) => normalized === kw || normalized.includes(kw));
};

export const isEditKeyword = (message = "") => {
  const normalized = String(message || "").trim().toLowerCase();
  if (EDIT_KEYWORDS.includes(normalized)) return true;
  return /^(edit|change|modify)\s+/.test(normalized);
};

const validateName = (value) => {
  const name = String(value || "").replace(/\s+/g, " ").trim();
  if (name.length < 2) return { valid: false };
  if (/^\d+$/.test(name)) return { valid: false };
  return { valid: true, value: name };
};

const validateEmail = (value) => {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { valid: false };
  return { valid: true, value: email };
};

const hasRequiredBookingEmail = (draft = {}) =>
  Boolean(draft.email && draft.emailCollectedInSession === true);

const validateReason = (value) => {
  const reason = String(value || "").replace(/\s+/g, " ").trim();
  if (reason.length < 2) return { valid: false };
  return { valid: true, value: reason };
};

const responseTypeFromPayload = (payload) =>
  payload?.type === "interactive" ? "interactive" : "text";

const payloadText = (payload) => {
  if (!payload) return "";
  if (payload.type === "text") return payload.text?.body || "";
  return payload.interactive?.body?.text || "";
};

const makeResult = ({ payload, payloads = null, session, event = null, extra = {} }) => {
  const firstPayload = payload || payloads?.[0] || null;
  return {
    success: true,
    message: payloadText(firstPayload),
    payload: firstPayload,
    payloads,
    messageType: responseTypeFromPayload(firstPayload),
    interactive_payload: firstPayload?.type === "interactive" ? JSON.stringify(firstPayload) : null,
    session: session
      ? {
          session_id: session.session_id,
          state: session.current_step,
          status: session.status,
          draft: getSessionDraft(session),
          expires_at: session.expires_at,
        }
      : null,
    event,
    ...extra,
  };
};

const emitAppointmentEvent = (tenantId, event, session, extra = {}) => {
  try {
    const io = getIO();
    const payload = {
      tenantId,
      userPhone: session?.user_phone || null,
      sessionId: session?.session_id || null,
      state: session?.current_step || null,
      previousState: extra.previousState || null,
      draft: session ? getSessionDraft(session) : null,
      status: session?.status || null,
      updatedAt: new Date(),
      ...extra,
    };
    io.to(`tenant-${tenantId}`).emit(event, payload);
  } catch (err) {
    console.error("[ADV-APPT] Socket emit failed:", err.message);
  }
};

const logTransition = async (context, fromState, toState) => {
  await logAppointmentStateTransition({
    tenantId: context.tenantId,
    userPhone: context.userPhone,
    sessionId: context.session?.session_id,
    fromState,
    toState,
    message: context.message || null,
    replyId: context.interactiveReplyId || null,
    whatsappMessageId: context.whatsappMessageId || null,
  });
};

const logAppointmentDebug = (event, payload) => {
  try {
    console.log(`[ADV-APPT] ${event}`, JSON.stringify(payload));
  } catch {
    console.log(`[ADV-APPT] ${event}`, payload);
  }
};

const transitionAndPrompt = async (context, toState, options = {}) => {
  const fromState = context.session.current_step;
  const session = await transitionAppointmentState({
    session: context.session,
    toState,
    draft: options.draft ?? null,
    editTarget: options.editTarget,
    lastValidState: options.lastValidState ?? toState,
    refreshTimeout: options.refreshTimeout !== false,
  });
  context.session = session;
  await logTransition(context, fromState, toState);
  emitAppointmentEvent(context.tenantId, "appointment_state_changed", session, {
    previousState: fromState,
  });
  if (options.emitDraft !== false) {
    emitAppointmentEvent(context.tenantId, "appointment_draft_updated", session);
  }
  return sendStatePrompt(context, toState);
};

const enterIrrelevantInputGuard = async (context, reason = null) => {
  const fromState = context.session.current_step;
  const session = await transitionAppointmentState({
    session: context.session,
    toState: APPOINTMENT_STATES.AWAITING_RESUME_DECISION,
    lastValidState: fromState,
    refreshTimeout: false,
  });
  context.session = session;
  await logTransition(context, fromState, APPOINTMENT_STATES.AWAITING_RESUME_DECISION);
  emitAppointmentEvent(context.tenantId, "appointment_state_changed", session, {
    previousState: fromState,
    reason,
  });
  return makeResult({
    payload: buildAppointmentResumeCancelPayload(context.userPhone, fromState),
    session,
  });
};

const askCancelConfirmation = async (context) => {
  const fromState = context.session.current_step;
  const session = await transitionAppointmentState({
    session: context.session,
    toState: APPOINTMENT_STATES.AWAITING_RESUME_DECISION,
    lastValidState: fromState,
    refreshTimeout: false,
  });
  context.session = session;
  await logTransition(context, fromState, APPOINTMENT_STATES.AWAITING_RESUME_DECISION);
  return makeResult({
    payload: buildQuitPayload(context.userPhone),
    session,
  });
};

const cancelSessionAndRespond = async (context, message = "Appointment booking cancelled.") => {
  const fromState = context.session.current_step;
  await releaseLockedSlots(context.session.session_id);
  const session = await cancelAppointmentSession(context.session);
  context.session = session;
  await logTransition(context, fromState, null);
  emitAppointmentEvent(context.tenantId, "appointment_cancelled", session, {
    previousState: fromState,
  });
  return makeResult({
    payload: buildTextPayload(context.userPhone, message),
    session,
    event: "appointment_cancelled",
  });
};

const getAvailableDoctors = async (tenantId) => {
  const doctors = await getDoctorListService(tenantId);
  return (doctors || []).filter((doctor) => doctor.status === "available");
};

export const buildAvailableDoctorListAppointmentResponse = async ({
  tenantId,
  userPhone,
}) => {
  const doctors = await getAvailableDoctors(tenantId);
  if (!doctors.length) {
    return makeResult({
      payload: buildTextPayload(userPhone, "No doctors are available right now. Please try again later."),
      session: null,
    });
  }

  return makeResult({
    payload: buildDoctorListPayload(userPhone, doctors),
    session: null,
  });
};

const uniqueDoctors = (doctors = []) => {
  const seen = new Set();
  return doctors.filter((doctor) => {
    if (!doctor?.doctor_id || seen.has(doctor.doctor_id)) return false;
    seen.add(doctor.doctor_id);
    return true;
  });
};

const getDoctorsBySpecialization = async ({ tenantId, specializationId }) => {
  if (!specializationId) return [];
  const doctors = await getAvailableDoctors(tenantId);
  return doctors.filter((doctor) =>
    (doctor.specializations || []).some(
      (specialization) => specialization.specialization_id === specializationId,
    ),
  );
};

const getGeneralDoctors = async ({ tenantId }) => {
  const doctors = await getAvailableDoctors(tenantId);
  const generalByName = doctors.filter((doctor) =>
    (doctor.specializations || []).some(
      (specialization) => String(specialization.name || "").trim().toLowerCase() === "general",
    ),
  );
  const withoutSpecialization = doctors.filter(
    (doctor) => !(doctor.specializations || []).length,
  );
  return uniqueDoctors([...generalByName, ...withoutSpecialization]);
};

const resolveDoctorListForDraft = async ({ tenantId, draft }) => {
  const reasonSource = String(draft.reasonSource || "").toUpperCase();
  const selectedSpecializationId =
    draft.selectedSpecializationId || draft.reasonServiceId || null;
  if (
    (reasonSource === REASON_SOURCE.SERVICE_MENU || reasonSource === "SERVICE") &&
    selectedSpecializationId
  ) {
    const specializationDoctors = await getDoctorsBySpecialization({
      tenantId,
      specializationId: selectedSpecializationId,
    });

    if (specializationDoctors.length) {
      return {
        doctors: specializationDoctors,
        doctorListMode: DOCTOR_LIST_MODE.FILTERED_BY_SPECIALIZATION,
      };
    }

    const generalDoctors = await getGeneralDoctors({ tenantId });
    if (generalDoctors.length) {
      return {
        doctors: generalDoctors,
        doctorListMode: DOCTOR_LIST_MODE.GENERAL_DOCTOR_FALLBACK,
      };
    }

    return {
      doctors: [],
      doctorListMode: DOCTOR_LIST_MODE.FILTERED_BY_SPECIALIZATION,
    };
  }

  return {
    doctors: await getAvailableDoctors(tenantId),
    doctorListMode: DOCTOR_LIST_MODE.ALL_ACTIVE_DOCTORS,
  };
};

const getDoctorById = async (tenantId, doctorId) => {
  const doctors = await getDoctorListService(tenantId);
  return (doctors || []).find(
    (doctor) => doctor.doctor_id === doctorId && doctor.status === "available",
  );
};

const getLockedOrBookedTimes = async ({ tenantId, doctorId, date, sessionId }) => {
  const rows = await db.AppointmentSlots.findAll({
    where: {
      tenant_id: tenantId,
      doctor_id: doctorId,
      appointment_date: date,
      status: { [Op.in]: ["LOCKED", "BOOKED"] },
      [Op.or]: [
        { status: "BOOKED" },
        { locked_by_session_id: sessionId },
        { locked_until: { [Op.gt]: new Date() } },
      ],
    },
    attributes: ["appointment_time", "status", "locked_by_session_id"],
  });
  return rows.map((row) => ({
    time: row.appointment_time,
    status: row.status,
    lockedBy: row.locked_by_session_id,
  }));
};

const getAvailableSlotsWithLocks = async ({ tenantId, doctorId, date, session }) => {
  const result = await getAvailableSlotsService(tenantId, doctorId, date);
  const baseSlots = (result?.slots || [])
    .map((slot) => ({
      ...(typeof slot === "object" && slot !== null ? slot : {}),
      time: String(slot?.time || slot || "").trim(),
    }))
    .filter((slot) => slot.time);
  if (!baseSlots.length) return [];

  const blocked = await getLockedOrBookedTimes({
    tenantId,
    doctorId,
    date,
    sessionId: session.session_id,
  });
  const blockedByOther = new Set(
    blocked
      .filter((slot) => slot.status === "BOOKED" || slot.lockedBy !== session.session_id)
      .map((slot) => slot.time),
  );

  return baseSlots.filter((slot) => !blockedByOther.has(slot.time));
};

const isDateAvailable = async ({ tenantId, doctor, date, session }) => {
  if (!doctor || isPastDate(date)) return false;
  const day = getDayOfWeek(date);
  const worksThatDay = (doctor.availability || []).some((a) => a.day_of_week === day);
  if (!worksThatDay) return false;
  const slots = await getAvailableSlotsWithLocks({
    tenantId,
    doctorId: doctor.doctor_id,
    date,
    session,
  });
  return slots.length > 0;
};

const getAvailableDatesForDoctor = async ({ tenantId, doctor, session }) => {
  const dates = [];
  const cursor = new Date();

  for (let offset = 1; offset <= 14 && dates.length < 7; offset += 1) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() + offset);
    const value = toDateOnly(d);
    const ok = await isDateAvailable({ tenantId, doctor, date: value, session });
    if (!ok) continue;
    dates.push({
      value,
      label: d.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      description: d.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    });
  }

  return dates;
};

const getAvailableReasonServices = async (tenantId) => {
  const [rows] = await db.sequelize.query(
    `SELECT DISTINCT
        s.specialization_id,
        s.name,
        s.description
     FROM ${tableNames.SPECIALIZATIONS} s
     WHERE s.tenant_id = ?
       AND s.is_active = true
       AND s.is_deleted = false
     ORDER BY s.name ASC
     LIMIT 10`,
    { replacements: [tenantId] },
  );

  return (rows || []).map((row) => ({
    specialization_id: row.specialization_id,
    id: row.specialization_id,
    specializationId: row.specialization_id,
    specializationName: row.name,
    name: row.name,
    description: row.description,
  }));
};

const getAvailableReasonServiceById = async (tenantId, serviceId) => {
  const services = await getAvailableReasonServices(tenantId);
  return services.find((service) => service.specialization_id === serviceId) || null;
};

const safeParseJsonObject = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const validateManualReasonWithAI = async ({ tenantId, reason, services }) => {
  try {
    const domainSummary = await getDomainSummary(tenantId);
    const serviceNames = (services || [])
      .map((service) => service.name)
      .filter(Boolean)
      .join(", ") || "No service list configured";

    const prompt = `You validate appointment booking reason text for a business.

BUSINESS CONTEXT:
${domainSummary}

AVAILABLE SERVICES:
${serviceNames}

USER MANUAL REASON:
"${reason}"

Decide if the user text is a genuine reason/service need relevant to this tenant's business.

Valid examples depend on business context:
- Eye hospital: eye pain, blurred vision, cataract, retina, general eye checkup.
- Salon: haircut, beard trim, facial, hair color.
- Legal consultation: property issue, contract advice, divorce consultation.
- Car service center: AC not cooling, engine noise, oil change.

Invalid:
- Timings, price, location, or general questions.
- Food orders, jokes, random words, spam, emoji-only text.
- Service needs outside this tenant's business.

Return only JSON:
{
  "valid": true,
  "category": "valid_reason",
  "confidence": 0.93,
  "normalizedReason": "short clean reason",
  "reason": "one sentence"
}`;

    const result = await callAI({
      messages: [{ role: "user", content: prompt }],
      tenant_id: tenantId,
      source: "classifier",
      temperature: 0,
      responseFormat: { type: "json_object" },
    });

    const parsed = safeParseJsonObject(result.content);
    const isValid =
      parsed?.valid === true ||
      String(parsed?.valid || "").toLowerCase() === "true";

    if (!parsed || !isValid) {
      return {
        valid: false,
        reason: parsed?.reason || "AI classified reason as irrelevant",
      };
    }

    const normalizedReason = String(parsed.normalizedReason || reason)
      .replace(/\s+/g, " ")
      .trim();

    return {
      valid: true,
      normalizedReason: normalizedReason || reason,
      category: parsed.category || "valid_reason",
      confidence: parsed.confidence ?? null,
      reason: parsed.reason || "Relevant appointment reason",
    };
  } catch (err) {
    console.error("[ADV-APPT] Reason AI validation failed:", err.message);
    return {
      valid: false,
      reason: "AI validation failed",
    };
  }
};

const updateReasonInvalidAttempts = async (session, attempts) => {
  const draft = {
    ...getSessionDraft(session),
    _reasonInvalidAttempts: attempts,
  };
  await session.update({
    draft_json: draft,
    updatedAt: new Date(),
  });
  await session.reload();
  return draft;
};

const sendReasonPrompt = async (context, bodyText = "Please select our services for visit from the list, or type reason for Visit.") => {
  const services = await getAvailableReasonServices(context.tenantId);
  if (services.length) {
    return makeStatePromptResult({
      context,
      state: APPOINTMENT_STATES.COLLECT_REASON,
      payload: buildReasonServiceListPayload(context.userPhone, services, bodyText),
    });
  }

  return makeStatePromptResult({
    context,
    state: APPOINTMENT_STATES.COLLECT_REASON,
    payload: buildTextPayload(context.userPhone, bodyText),
  });
};

const handleInvalidManualReason = async (context, reasonCode) => {
  const draft = getSessionDraft(context.session);
  const attempts = Number(draft._reasonInvalidAttempts || 0) + 1;
  await updateReasonInvalidAttempts(context.session, attempts);

  emitAppointmentEvent(context.tenantId, "appointment_draft_updated", context.session, {
    reason: reasonCode,
  });

  if (attempts >= 2) {
    return enterIrrelevantInputGuard(context, reasonCode);
  }

  return sendReasonPrompt(
    context,
    "Please choose a service from the list, or type a reason related to your appointment.",
  );
};

const shouldMoveLegacySessionToReasonStep = (session) => {
  if (session.current_step !== APPOINTMENT_STATES.SELECT_DOCTOR) return false;
  const draft = getSessionDraft(session);
  return Boolean(
    hasRequiredBookingEmail(draft) &&
      !draft.reason &&
      !draft.reasonServiceId &&
      !draft.reasonSource &&
      !draft.doctorId &&
      !draft.date &&
      !draft.time,
  );
};

export const getNextIncompleteAppointmentState = (draft = {}) => {
  if (!draft.name) return APPOINTMENT_STATES.COLLECT_NAME;
  if (!hasRequiredBookingEmail(draft)) return APPOINTMENT_STATES.COLLECT_EMAIL;
  if (!draft.reason) return APPOINTMENT_STATES.COLLECT_REASON;
  if (!draft.doctorId) return APPOINTMENT_STATES.SELECT_DOCTOR;
  if (!draft.date) return APPOINTMENT_STATES.SELECT_DATE;
  if (!draft.time) return APPOINTMENT_STATES.SELECT_TIME;
  return APPOINTMENT_STATES.CONFIRM_BOOKING;
};

export const getEditableFieldsByState = ({ currentState, draft = {} }) => {
  const fields = [];
  const canShowEmail = ![
    APPOINTMENT_STATES.COLLECT_NAME,
    APPOINTMENT_STATES.COLLECT_EMAIL,
  ].includes(currentState);
  const canShowReason = [
    APPOINTMENT_STATES.SELECT_DOCTOR,
    APPOINTMENT_STATES.SELECT_DATE,
    APPOINTMENT_STATES.SELECT_TIME,
    APPOINTMENT_STATES.CONFIRM_BOOKING,
  ].includes(currentState);
  const canShowDoctor = [
    APPOINTMENT_STATES.SELECT_DATE,
    APPOINTMENT_STATES.SELECT_TIME,
    APPOINTMENT_STATES.CONFIRM_BOOKING,
  ].includes(currentState);
  const canShowDate = [
    APPOINTMENT_STATES.SELECT_TIME,
    APPOINTMENT_STATES.CONFIRM_BOOKING,
  ].includes(currentState);

  if (
    draft.name &&
    ![
      APPOINTMENT_STATES.COLLECT_NAME,
      APPOINTMENT_STATES.COLLECT_EMAIL,
    ].includes(currentState)
  ) {
    fields.push({ id: "edit_name", title: "Name", description: draft.name });
  }

  if (draft.email && canShowEmail) {
    fields.push({ id: "edit_email", title: "Email", description: draft.email });
  }

  if (draft.reason && canShowReason) {
    fields.push({
      id: "edit_reason",
      title: "Reason / Service",
      description: draft.reason,
    });
  }

  if (draft.doctorId && canShowDoctor) {
    fields.push({
      id: "edit_doctor",
      title: "Doctor",
      description: draft.doctorName || "Selected doctor",
    });
  }

  if (draft.date && canShowDate) {
    fields.push({ id: "edit_date", title: "Date", description: draft.date });
  }

  if (draft.time && currentState === APPOINTMENT_STATES.CONFIRM_BOOKING) {
    fields.push({ id: "edit_time", title: "Time Slot", description: draft.time });
  }

  fields.push({
    id: "continue_appointment",
    title: "Continue Appointment",
    description: "Continue appointment",
  });

  return fields;
};

const hasEditablePreviousFields = ({ currentState, draft }) =>
  getEditableFieldsByState({ currentState, draft }).some(
    (field) => field.id !== "continue_appointment",
  );

const makeStatePromptResult = ({ context, payload }) => {
  return makeResult({
    payload,
    session: context.session,
  });
};

const SESSION_REQUIRED_REPLY_TYPES = new Set([
  APPOINTMENT_REPLY_TYPES.DATE_SELECTED,
  APPOINTMENT_REPLY_TYPES.SLOT_GROUP_SELECTED,
  APPOINTMENT_REPLY_TYPES.TIME_SELECTED,
  APPOINTMENT_REPLY_TYPES.REASON_SELECTED,
  APPOINTMENT_REPLY_TYPES.CONFIRM_BOOKING,
  APPOINTMENT_REPLY_TYPES.EDIT_DETAILS,
  APPOINTMENT_REPLY_TYPES.CANCEL_BOOKING,
  APPOINTMENT_REPLY_TYPES.CONTINUE_APPOINTMENT,
  APPOINTMENT_REPLY_TYPES.EDIT_NAME,
  APPOINTMENT_REPLY_TYPES.EDIT_EMAIL,
  APPOINTMENT_REPLY_TYPES.EDIT_DOCTOR,
  APPOINTMENT_REPLY_TYPES.EDIT_DATE,
  APPOINTMENT_REPLY_TYPES.EDIT_TIME,
  APPOINTMENT_REPLY_TYPES.EDIT_REASON,
  APPOINTMENT_REPLY_TYPES.BACK_TO_CONFIRM,
]);

const EDIT_REPLY_TYPES = new Set([
  APPOINTMENT_REPLY_TYPES.EDIT_NAME,
  APPOINTMENT_REPLY_TYPES.EDIT_EMAIL,
  APPOINTMENT_REPLY_TYPES.EDIT_DOCTOR,
  APPOINTMENT_REPLY_TYPES.EDIT_DATE,
  APPOINTMENT_REPLY_TYPES.EDIT_TIME,
  APPOINTMENT_REPLY_TYPES.EDIT_REASON,
]);

const isSessionRequiredBookingReply = (decodedReply, interactiveReplyId = null) =>
  Boolean(interactiveReplyId) && SESSION_REQUIRED_REPLY_TYPES.has(decodedReply?.type);

const makeStaleBookingReplyResult = async ({
  tenantId,
  userPhone,
  session = null,
  message = null,
  replyId = null,
  whatsappMessageId = null,
  reason = "stale_booking_reply",
}) => {
  await logAppointmentStateTransition({
    tenantId,
    userPhone,
    sessionId: session?.session_id || null,
    fromState: session?.current_step || null,
    toState: "STALE_BOOKING_REPLY",
    message,
    replyId,
    whatsappMessageId,
  });
  return makeResult({
    payload: buildStaleBookingManagePromptPayload(userPhone),
    session,
    event: "stale_booking_reply",
    extra: { staleBookingReply: true, reason },
  });
};

const makeBookingSessionExpiredResult = async ({
  tenantId,
  userPhone,
  session = null,
  message = null,
  replyId = null,
  whatsappMessageId = null,
  reason = "booking_session_expired",
}) => {
  await logAppointmentStateTransition({
    tenantId,
    userPhone,
    sessionId: session?.session_id || null,
    fromState: session?.current_step || null,
    toState: "BOOKING_SESSION_EXPIRED",
    message,
    replyId,
    whatsappMessageId,
  });
  return makeResult({
    payload: buildBookingSessionExpiredPayload(userPhone),
    session,
    event: "booking_session_expired",
    extra: { expiredBookingSession: true, reason },
  });
};

const BOOKING_OVERRIDE_REPLY_TYPES = {
  REASON: "reason",
  DOCTOR: "doctor",
  DATE: "date",
  TIME: "time",
};

const REASON_OVERRIDE_STATES = new Set([
  APPOINTMENT_STATES.SELECT_DOCTOR,
  APPOINTMENT_STATES.SELECT_DATE,
  APPOINTMENT_STATES.SELECT_TIME,
  APPOINTMENT_STATES.CONFIRM_BOOKING,
  APPOINTMENT_STATES.EDIT_MENU,
  APPOINTMENT_STATES.EDIT_FIELD,
]);

const DOCTOR_OVERRIDE_STATES = new Set([
  APPOINTMENT_STATES.SELECT_DATE,
  APPOINTMENT_STATES.SELECT_TIME,
  APPOINTMENT_STATES.CONFIRM_BOOKING,
  APPOINTMENT_STATES.EDIT_MENU,
  APPOINTMENT_STATES.EDIT_FIELD,
]);

const DATE_OVERRIDE_STATES = new Set([
  APPOINTMENT_STATES.SELECT_TIME,
  APPOINTMENT_STATES.CONFIRM_BOOKING,
  APPOINTMENT_STATES.EDIT_MENU,
  APPOINTMENT_STATES.EDIT_FIELD,
]);

const TIME_OVERRIDE_STATES = new Set([
  APPOINTMENT_STATES.CONFIRM_BOOKING,
  APPOINTMENT_STATES.EDIT_MENU,
  APPOINTMENT_STATES.EDIT_FIELD,
]);

export const getInSessionBookingOverrideType = ({ decodedReply, state }) => {
  const type = decodedReply?.type;
  if (type === APPOINTMENT_REPLY_TYPES.REASON_SELECTED && REASON_OVERRIDE_STATES.has(state)) {
    return BOOKING_OVERRIDE_REPLY_TYPES.REASON;
  }
  if (type === APPOINTMENT_REPLY_TYPES.DOCTOR_SELECTED && DOCTOR_OVERRIDE_STATES.has(state)) {
    return BOOKING_OVERRIDE_REPLY_TYPES.DOCTOR;
  }
  if (type === APPOINTMENT_REPLY_TYPES.DATE_SELECTED && DATE_OVERRIDE_STATES.has(state)) {
    return BOOKING_OVERRIDE_REPLY_TYPES.DATE;
  }
  if (
    [APPOINTMENT_REPLY_TYPES.TIME_SELECTED, APPOINTMENT_REPLY_TYPES.SLOT_GROUP_SELECTED].includes(type) &&
    TIME_OVERRIDE_STATES.has(state)
  ) {
    return BOOKING_OVERRIDE_REPLY_TYPES.TIME;
  }
  return null;
};

const handleInSessionBookingOverride = async (context, overrideType) => {
  await logAppointmentStateTransition({
    tenantId: context.tenantId,
    userPhone: context.userPhone,
    sessionId: context.session?.session_id || null,
    fromState: context.session?.current_step || null,
    toState: `OVERRIDE_${String(overrideType || "").toUpperCase()}`,
    message: context.message || null,
    replyId: context.interactiveReplyId || null,
    whatsappMessageId: context.whatsappMessageId || null,
  });

  if (overrideType === BOOKING_OVERRIDE_REPLY_TYPES.REASON) {
    return handleCollectReason(context);
  }
  if (overrideType === BOOKING_OVERRIDE_REPLY_TYPES.DOCTOR) {
    return handleSelectDoctor(context);
  }
  if (overrideType === BOOKING_OVERRIDE_REPLY_TYPES.DATE) {
    return handleSelectDate(context);
  }
  if (overrideType === BOOKING_OVERRIDE_REPLY_TYPES.TIME) {
    return handleSelectTime(context);
  }

  return sendStatePrompt(context, context.session.current_step);
};

const makeDuplicateBookingMessageResult = (session = null) => ({
  success: true,
  duplicate: true,
  suppressResponse: true,
  session: session
    ? {
        session_id: session.session_id,
        state: session.current_step,
        status: session.status,
        draft: getSessionDraft(session),
        expires_at: session.expires_at,
      }
    : null,
});

export const isReplyValidForBookingState = ({ decodedReply, state }) => {
  const type = decodedReply?.type;
  if (!type || type === APPOINTMENT_REPLY_TYPES.UNKNOWN) return true;

  if (state === APPOINTMENT_STATES.COLLECT_NAME) return false;
  if (state === APPOINTMENT_STATES.COLLECT_EMAIL) return false;

  if (state === APPOINTMENT_STATES.COLLECT_REASON) {
    return type === APPOINTMENT_REPLY_TYPES.REASON_SELECTED;
  }

  if (state === APPOINTMENT_STATES.SELECT_DOCTOR) {
    return (
      type === APPOINTMENT_REPLY_TYPES.DOCTOR_SELECTED ||
      type === APPOINTMENT_REPLY_TYPES.EDIT_DETAILS ||
      EDIT_REPLY_TYPES.has(type)
    );
  }

  if (state === APPOINTMENT_STATES.SELECT_DATE) {
    return (
      type === APPOINTMENT_REPLY_TYPES.DATE_SELECTED ||
      type === APPOINTMENT_REPLY_TYPES.EDIT_DETAILS ||
      EDIT_REPLY_TYPES.has(type)
    );
  }

  if (state === APPOINTMENT_STATES.SELECT_TIME) {
    return (
      type === APPOINTMENT_REPLY_TYPES.SLOT_GROUP_SELECTED ||
      type === APPOINTMENT_REPLY_TYPES.TIME_SELECTED ||
      type === APPOINTMENT_REPLY_TYPES.EDIT_DETAILS ||
      EDIT_REPLY_TYPES.has(type)
    );
  }

  if (state === APPOINTMENT_STATES.CONFIRM_BOOKING) {
    return [
      APPOINTMENT_REPLY_TYPES.CONFIRM_BOOKING,
      APPOINTMENT_REPLY_TYPES.EDIT_DETAILS,
      APPOINTMENT_REPLY_TYPES.CANCEL_BOOKING,
    ].includes(type) || EDIT_REPLY_TYPES.has(type);
  }

  if (state === APPOINTMENT_STATES.EDIT_MENU) {
    return (
      type === APPOINTMENT_REPLY_TYPES.CONTINUE_APPOINTMENT ||
      type === APPOINTMENT_REPLY_TYPES.BACK_TO_CONFIRM ||
      EDIT_REPLY_TYPES.has(type)
    );
  }

  if (state === APPOINTMENT_STATES.AWAITING_RESUME_DECISION) {
    return [
      APPOINTMENT_REPLY_TYPES.CONTINUE_APPOINTMENT,
      APPOINTMENT_REPLY_TYPES.CANCEL_BOOKING,
    ].includes(type);
  }

  if (state === APPOINTMENT_STATES.EDIT_FIELD) return false;
  if (state === APPOINTMENT_STATES.BOOKING_COMPLETE) return false;

  return true;
};

const clearSlotSelectionFromDraft = (draft = {}) => {
  const nextDraft = { ...draft };
  delete nextDraft.slotSelection;
  return nextDraft;
};

const isEditRequest = (context) =>
  context.decodedReply.type === APPOINTMENT_REPLY_TYPES.EDIT_DETAILS ||
  isEditKeyword(context.message);

const getEditTargetByReplyType = (type) => ({
  [APPOINTMENT_REPLY_TYPES.EDIT_NAME]: "edit_name",
  [APPOINTMENT_REPLY_TYPES.EDIT_EMAIL]: "edit_email",
  [APPOINTMENT_REPLY_TYPES.EDIT_DOCTOR]: "edit_doctor",
  [APPOINTMENT_REPLY_TYPES.EDIT_DATE]: "edit_date",
  [APPOINTMENT_REPLY_TYPES.EDIT_TIME]: "edit_time",
  [APPOINTMENT_REPLY_TYPES.EDIT_REASON]: "edit_reason",
}[type] || null);

const openContextualEditMenu = async (context) => {
  const currentState = context.session.current_step;
  const draft = getSessionDraft(context.session);
  const editableFields = getEditableFieldsByState({ currentState, draft });
  logAppointmentDebug("open_contextual_edit_menu", {
    tenantId: context.tenantId,
    userPhone: context.userPhone,
    state: currentState,
    action: "OPEN_CONTEXTUAL_EDIT_MENU",
    editableFields: editableFields.map((field) => field.id),
    lastValidState: currentState,
  });
  context.session = await transitionAppointmentState({
    session: context.session,
    toState: APPOINTMENT_STATES.EDIT_MENU,
    lastValidState: currentState,
    editTarget: null,
    refreshTimeout: true,
  });
  return makeResult({
    payload: buildEditMenuPayload(context.userPhone, editableFields),
    session: context.session,
  });
};

export const getEditResetForTarget = (target, draft = {}) => {
  if (target === "edit_name") {
    return {
      draft,
      nextState: APPOINTMENT_STATES.EDIT_FIELD,
      editTarget: target,
      clearedFields: [],
      releaseLock: false,
    };
  }

  if (target === "edit_email") {
    return {
      draft,
      nextState: APPOINTMENT_STATES.EDIT_FIELD,
      editTarget: target,
      clearedFields: [],
      releaseLock: false,
    };
  }

  if (target === "edit_reason") {
    return {
      draft: clearSlotSelectionFromDraft({
        ...draft,
        reason: null,
        reasonSource: null,
        reasonServiceId: null,
        reasonAiValidation: null,
        selectedSpecializationId: null,
        selectedSpecializationName: null,
        doctorListMode: null,
        doctorId: null,
        doctorName: null,
        date: null,
        time: null,
        _reasonInvalidAttempts: 0,
      }),
      nextState: APPOINTMENT_STATES.COLLECT_REASON,
      clearedFields: [
        "reason",
        "reasonSource",
        "reasonServiceId",
        "reasonAiValidation",
        "selectedSpecializationId",
        "selectedSpecializationName",
        "doctorListMode",
        "doctorId",
        "doctorName",
        "date",
        "time",
      ],
      releaseLock: true,
    };
  }

  if (target === "edit_doctor") {
    return {
      draft: clearSlotSelectionFromDraft({
        ...draft,
        doctorId: null,
        doctorName: null,
        date: null,
        time: null,
      }),
      nextState: APPOINTMENT_STATES.SELECT_DOCTOR,
      clearedFields: ["doctorId", "doctorName", "date", "time"],
      releaseLock: true,
    };
  }

  if (target === "edit_date") {
    return {
      draft: clearSlotSelectionFromDraft({ ...draft, date: null, time: null }),
      nextState: APPOINTMENT_STATES.SELECT_DATE,
      clearedFields: ["date", "time"],
      releaseLock: true,
    };
  }

  if (target === "edit_time") {
    return {
      draft: clearSlotSelectionFromDraft({ ...draft, time: null }),
      nextState: APPOINTMENT_STATES.SELECT_TIME,
      clearedFields: ["time"],
      releaseLock: true,
    };
  }

  return null;
};

const handleContextualEditSelection = async (context, currentState) => {
  const editTarget = getEditTargetByReplyType(context.decodedReply.type);
  if (!editTarget) return null;

  const draft = getSessionDraft(context.session);
  const editableIds = new Set(
    getEditableFieldsByState({ currentState, draft }).map((field) => field.id),
  );
  if (!editableIds.has(editTarget)) {
    return enterIrrelevantInputGuard(context, "invalid_contextual_edit_reply");
  }

  const reset = getEditResetForTarget(editTarget, draft);
  if (!reset) {
    return enterIrrelevantInputGuard(context, "invalid_edit_reply");
  }

  if (reset.releaseLock) {
    await releaseLockedSlots(context.session.session_id);
  }

  logAppointmentDebug("edit_field_selected", {
    tenantId: context.tenantId,
    userPhone: context.userPhone,
    action: "EDIT_FIELD_SELECTED",
    field: editTarget,
    nextState: reset.nextState,
    clearedFields: reset.clearedFields,
  });

  return transitionAndPrompt(context, reset.nextState, {
    draft: reset.draft,
    editTarget: reset.editTarget || null,
    lastValidState: reset.nextState,
  });
};

const sendStatePrompt = async (context, state = context.session.current_step) => {
  let draft = getSessionDraft(context.session);

  if (state === APPOINTMENT_STATES.COLLECT_NAME) {
    return makeStatePromptResult({
      context,
      state,
      payload: buildTextPayload(context.userPhone, "What is the patient name?"),
    });
  }

  if (state === APPOINTMENT_STATES.COLLECT_EMAIL) {
    return makeStatePromptResult({
      context,
      state,
      payload: buildTextPayload(context.userPhone, "Please share your email address for confirmation."),
    });
  }

  if (state === APPOINTMENT_STATES.SELECT_DOCTOR) {
    const resolved = await resolveDoctorListForDraft({
      tenantId: context.tenantId,
      draft,
    });
    const doctors = resolved.doctors;
    if (draft.doctorListMode !== resolved.doctorListMode) {
      draft = { ...draft, doctorListMode: resolved.doctorListMode };
      await context.session.update({
        draft_json: draft,
        updatedAt: new Date(),
      });
      await context.session.reload();
    }
    if (!doctors.length) {
      return makeResult({
        payload: buildTextPayload(context.userPhone, "No doctors are available right now. Please try again later."),
        session: context.session,
      });
    }
    return makeStatePromptResult({
      context,
      state,
      payload: buildDoctorListPayload(context.userPhone, doctors),
    });
  }

  if (state === APPOINTMENT_STATES.SELECT_DATE) {
    const doctor = await getDoctorById(context.tenantId, draft.doctorId);
    const dates = await getAvailableDatesForDoctor({
      tenantId: context.tenantId,
      doctor,
      session: context.session,
    });
    if (!dates.length) {
      return makeResult({
        payload: buildTextPayload(context.userPhone, "No dates are available for this doctor. Please choose another doctor."),
        session: context.session,
      });
    }
    return makeStatePromptResult({
      context,
      state,
      payload: buildDateListPayload(context.userPhone, dates),
    });
  }

  if (state === APPOINTMENT_STATES.SELECT_TIME) {
    const slots = await getAvailableSlotsWithLocks({
      tenantId: context.tenantId,
      doctorId: draft.doctorId,
      date: draft.date,
      session: context.session,
    });
    if (!slots.length) {
      await updateAppointmentDraft(context.session, { slotSelection: undefined });
      return makeResult({
        payload: buildTextPayload(context.userPhone, "No slots are available for this date. Please choose another date."),
        session: context.session,
      });
    }
    const slotSelection = buildSlotSelectionContext({
      doctorId: draft.doctorId,
      date: draft.date,
      slots,
    });
    await updateAppointmentDraft(context.session, { slotSelection });
    const slotRows = getSlotSelectionRows(slotSelection);
    return makeStatePromptResult({
      context,
      state,
      payload: buildTimeSlotPayload(context.userPhone, slotRows.rows, {
        bodyText: slotRows.message,
        sectionTitle: slotRows.sectionTitle,
      }),
    });
  }

  if (state === APPOINTMENT_STATES.COLLECT_REASON) {
    return sendReasonPrompt(context);
  }

  if (state === APPOINTMENT_STATES.CONFIRM_BOOKING) {
    return makeStatePromptResult({
      context,
      state,
      payload: buildConfirmPayload(
        context.userPhone,
        draft,
        context.session?.session_id || null,
      ),
    });
  }

  if (state === APPOINTMENT_STATES.EDIT_MENU) {
    const editContextState =
      context.session.last_valid_state || APPOINTMENT_STATES.CONFIRM_BOOKING;
    const editableFields = getEditableFieldsByState({
      currentState: editContextState,
      draft,
    });
    return makeResult({
      payload: buildEditMenuPayload(context.userPhone, editableFields),
      session: context.session,
    });
  }

  if (state === APPOINTMENT_STATES.EDIT_FIELD) {
    const target = context.session.edit_target;
    const prompt =
      target === "edit_name"
        ? "Please enter the updated patient name."
        : target === "edit_email"
          ? "Please enter the updated email address."
          : target === "edit_reason"
            ? "Please enter the updated reason for visit."
            : "Please select the detail you want to update.";
    return makeResult({
      payload: buildTextPayload(context.userPhone, prompt),
      session: context.session,
    });
  }

  return makeResult({
    payload: buildTextPayload(context.userPhone, "How can I help with your appointment?"),
    session: context.session,
  });
};

export const handleCollectName = async (context) => {
  const validation = validateName(context.message);
  if (!validation.valid) return enterIrrelevantInputGuard(context, "invalid_name");
  const draft = await updateAppointmentDraft(context.session, { name: validation.value });
  return transitionAndPrompt(context, getNextIncompleteAppointmentState(draft), { draft });
};

export const handleCollectEmail = async (context) => {
  const validation = validateEmail(context.message);
  if (!validation.valid) return enterIrrelevantInputGuard(context, "invalid_email");
  const draft = await updateAppointmentDraft(context.session, {
    email: validation.value,
    emailCollectedInSession: true,
  });
  return transitionAndPrompt(context, getNextIncompleteAppointmentState(draft), { draft });
};

export const handleSelectDoctor = async (context) => {
  if (context.decodedReply.type !== APPOINTMENT_REPLY_TYPES.DOCTOR_SELECTED) {
    return enterIrrelevantInputGuard(context, "invalid_doctor_reply");
  }
  const currentDraft = getSessionDraft(context.session);
  const resolved = await resolveDoctorListForDraft({
    tenantId: context.tenantId,
    draft: currentDraft,
  });
  let doctor = resolved.doctors.find(
    (item) => item.doctor_id === context.decodedReply.value,
  );
  let doctorListMode = resolved.doctorListMode;

  if (!doctor) {
    doctor = await getDoctorById(context.tenantId, context.decodedReply.value);
    doctorListMode = doctor ? DOCTOR_LIST_MODE.ALL_ACTIVE_DOCTORS : resolved.doctorListMode;
  }

  if (!doctor) return enterIrrelevantInputGuard(context, "doctor_not_available");

  if (
    currentDraft.time ||
    currentDraft.slotSelection ||
    (currentDraft.doctorId && currentDraft.doctorId !== doctor.doctor_id)
  ) {
    await releaseLockedSlots(context.session.session_id);
  }

  const draft = await updateAppointmentDraft(context.session, {
    doctorId: doctor.doctor_id,
    doctorName: doctor.name,
    doctorListMode,
    date: null,
    time: null,
    slotSelection: undefined,
  });

  return transitionAndPrompt(context, getNextIncompleteAppointmentState(draft), { draft });
};

export const handleSelectDate = async (context) => {
  if (context.decodedReply.type !== APPOINTMENT_REPLY_TYPES.DATE_SELECTED) {
    return enterIrrelevantInputGuard(context, "invalid_date_reply");
  }

  const draft = getSessionDraft(context.session);
  const doctor = await getDoctorById(context.tenantId, draft.doctorId);
  const available = await isDateAvailable({
    tenantId: context.tenantId,
    doctor,
    date: context.decodedReply.value,
    session: context.session,
  });
  if (!available) return enterIrrelevantInputGuard(context, "date_not_available");

  if (
    draft.time ||
    draft.slotSelection ||
    (draft.date && draft.date !== context.decodedReply.value)
  ) {
    await releaseLockedSlots(context.session.session_id);
  }

  const nextDraft = await updateAppointmentDraft(context.session, {
    date: context.decodedReply.value,
    time: null,
    slotSelection: undefined,
  });
  return transitionAndPrompt(context, getNextIncompleteAppointmentState(nextDraft), {
    draft: nextDraft,
  });
};

export const handleSelectTime = async (context) => {
  const draft = getSessionDraft(context.session);
  const slotSelection = draft.slotSelection || null;

  if (context.decodedReply.type === APPOINTMENT_REPLY_TYPES.SLOT_GROUP_SELECTED) {
    const resolvedGroup = resolveSlotSelection(context.decodedReply.value, slotSelection);
    if (resolvedGroup?.type !== "group") {
      return enterIrrelevantInputGuard(context, "invalid_slot_group_reply");
    }

    const nextSlotSelection = {
      ...slotSelection,
      selectedGroupId: resolvedGroup.group.id,
    };
    await updateAppointmentDraft(context.session, { slotSelection: nextSlotSelection });
    const slotRows = getSlotSelectionRows(nextSlotSelection, resolvedGroup.group.id);

    return makeStatePromptResult({
      context,
      state: APPOINTMENT_STATES.SELECT_TIME,
      payload: buildTimeSlotPayload(context.userPhone, slotRows.rows, {
        bodyText: slotRows.message,
        sectionTitle: slotRows.sectionTitle,
      }),
    });
  }

  if (context.decodedReply.type !== APPOINTMENT_REPLY_TYPES.TIME_SELECTED) {
    return enterIrrelevantInputGuard(context, "invalid_time_reply");
  }

  const resolvedSlot = resolveSlotSelection(
    context.interactiveReplyId || context.decodedReply.value,
    slotSelection,
  );
  const selectedTime = resolvedSlot?.type === "slot"
    ? resolvedSlot.slot.time
    : context.decodedReply.value;
  const slots = await getAvailableSlotsWithLocks({
    tenantId: context.tenantId,
    doctorId: draft.doctorId,
    date: draft.date,
    session: context.session,
  });
  const selected = slots.some((slot) => slot.time === selectedTime);
  if (!selected) {
    return makeResult({
      payload: buildTextPayload(context.userPhone, "Sorry, this slot is no longer available. Please choose another time."),
      session: context.session,
    });
  }

  const available = await checkAvailabilityService(
    context.tenantId,
    draft.doctorId,
    draft.date,
    selectedTime,
  );
  if (!available) {
    return makeResult({
      payload: buildTextPayload(context.userPhone, "Sorry, this slot is no longer available. Please choose another time."),
      session: context.session,
    });
  }

  if (draft.time && draft.time !== selectedTime) {
    await releaseLockedSlots(context.session.session_id);
  }

  await lockAppointmentSlot({
    tenantId: context.tenantId,
    session: context.session,
    doctorId: draft.doctorId,
    date: draft.date,
    time: selectedTime,
  });

  const nextDraft = await updateAppointmentDraft(context.session, {
    time: selectedTime,
    slotSelection: undefined,
  });
  return transitionAndPrompt(context, getNextIncompleteAppointmentState(nextDraft), {
    draft: nextDraft,
  });
};

export const handleCollectReason = async (context) => {
  const currentDraft = getSessionDraft(context.session);
  const clearDownstreamPatch = {
    doctorId: null,
    doctorName: null,
    date: null,
    time: null,
    slotSelection: undefined,
  };
  const hasDownstreamSelection = Boolean(
    currentDraft.doctorId ||
      currentDraft.doctorName ||
      currentDraft.date ||
      currentDraft.time ||
      currentDraft.slotSelection,
  );

  if (context.decodedReply.type === APPOINTMENT_REPLY_TYPES.REASON_SELECTED) {
    const service = await getAvailableReasonServiceById(
      context.tenantId,
      context.decodedReply.value,
    );
    if (!service) {
      return enterIrrelevantInputGuard(context, "invalid_reason_service");
    }

    const nextDraftPatch = {
      reason: service.name,
      reasonServiceId: service.specialization_id,
      reasonSource: REASON_SOURCE.SERVICE_MENU,
      selectedSpecializationId: service.specializationId || service.specialization_id,
      selectedSpecializationName: service.specializationName || service.name,
      reasonAiValidation: null,
      _reasonInvalidAttempts: 0,
      ...clearDownstreamPatch,
    };
    const resolved = await resolveDoctorListForDraft({
      tenantId: context.tenantId,
      draft: { ...currentDraft, ...nextDraftPatch },
    });
    if (hasDownstreamSelection) {
      await releaseLockedSlots(context.session.session_id);
    }
    const draft = await updateAppointmentDraft(context.session, {
      ...nextDraftPatch,
      doctorListMode: resolved.doctorListMode,
    });
    logAppointmentDebug("reason_service_selected", {
      tenantId: context.tenantId,
      userPhone: context.userPhone,
      state: APPOINTMENT_STATES.COLLECT_REASON,
      reasonSource: REASON_SOURCE.SERVICE_MENU,
      reasonServiceId: service.specialization_id,
      selectedSpecializationId: nextDraftPatch.selectedSpecializationId,
      doctorListMode: resolved.doctorListMode,
      doctorCount: resolved.doctors.length,
      finalAction: !resolved.doctors.length
        ? "NO_DOCTOR_FALLBACK"
        : resolved.doctorListMode === DOCTOR_LIST_MODE.GENERAL_DOCTOR_FALLBACK
          ? "SHOW_GENERAL_DOCTOR"
          : "SHOW_SPECIALIZATION_DOCTORS",
    });
    return transitionAndPrompt(context, getNextIncompleteAppointmentState(draft), { draft });
  }

  const validation = validateReason(context.message);
  if (!validation.valid) return handleInvalidManualReason(context, "invalid_reason");

  const services = await getAvailableReasonServices(context.tenantId);
  const aiValidation = await validateManualReasonWithAI({
    tenantId: context.tenantId,
    reason: validation.value,
    services,
  });
  if (!aiValidation.valid) {
    return handleInvalidManualReason(context, "irrelevant_reason");
  }

  const nextDraftPatch = {
    reason: aiValidation.normalizedReason || validation.value,
    reasonServiceId: null,
    reasonSource: REASON_SOURCE.MANUAL_TEXT,
    selectedSpecializationId: null,
    selectedSpecializationName: null,
    reasonAiValidation: {
      confidence: aiValidation.confidence ?? null,
      category: aiValidation.category || "valid_reason",
      reason: aiValidation.reason || null,
    },
    doctorListMode: DOCTOR_LIST_MODE.ALL_ACTIVE_DOCTORS,
    _reasonInvalidAttempts: 0,
    ...clearDownstreamPatch,
  };
  const resolved = await resolveDoctorListForDraft({
    tenantId: context.tenantId,
    draft: { ...currentDraft, ...nextDraftPatch },
  });
  if (hasDownstreamSelection) {
    await releaseLockedSlots(context.session.session_id);
  }
  const draft = await updateAppointmentDraft(context.session, nextDraftPatch);
  logAppointmentDebug("manual_reason_accepted", {
    tenantId: context.tenantId,
    userPhone: context.userPhone,
    state: APPOINTMENT_STATES.COLLECT_REASON,
    reasonSource: REASON_SOURCE.MANUAL_TEXT,
    doctorListMode: DOCTOR_LIST_MODE.ALL_ACTIVE_DOCTORS,
    doctorCount: resolved.doctors.length,
    finalAction: "SHOW_ALL_DOCTORS",
  });
  return transitionAndPrompt(context, getNextIncompleteAppointmentState(draft), { draft });
};

export const handleConfirmBooking = async (context) => {
  if (context.decodedReply.type === APPOINTMENT_REPLY_TYPES.EDIT_DETAILS) {
    return openContextualEditMenu(context);
  }

  if (context.decodedReply.type === APPOINTMENT_REPLY_TYPES.CANCEL_BOOKING) {
    return cancelSessionAndRespond(context);
  }

  if (context.decodedReply.type !== APPOINTMENT_REPLY_TYPES.CONFIRM_BOOKING) {
    return enterIrrelevantInputGuard(context, "invalid_confirm_reply");
  }

  return handleBookingComplete(context);
};

export const handleEditMenu = async (context) => {
  const type = context.decodedReply.type;
  if (
    type === APPOINTMENT_REPLY_TYPES.CONTINUE_APPOINTMENT ||
    type === APPOINTMENT_REPLY_TYPES.BACK_TO_CONFIRM
  ) {
    const draft = getSessionDraft(context.session);
    const restoreState =
      context.session.last_valid_state || getNextIncompleteAppointmentState(draft);
    return transitionAndPrompt(context, restoreState, {
      editTarget: null,
      emitDraft: false,
    });
  }

  const editTarget = getEditTargetByReplyType(type);
  if (!editTarget) return enterIrrelevantInputGuard(context, "invalid_edit_reply");

  return handleContextualEditSelection(
    context,
    context.session.last_valid_state || APPOINTMENT_STATES.CONFIRM_BOOKING,
  );
};

export const handleEditField = async (context) => {
  const target = context.session.edit_target;
  let patch = null;

  if (target === "edit_name") {
    const validation = validateName(context.message);
    if (!validation.valid) return enterIrrelevantInputGuard(context, "invalid_edit_name");
    patch = { name: validation.value };
  } else if (target === "edit_email") {
    const validation = validateEmail(context.message);
    if (!validation.valid) return enterIrrelevantInputGuard(context, "invalid_edit_email");
    patch = { email: validation.value, emailCollectedInSession: true };
  } else if (target === "edit_reason") {
    const validation = validateReason(context.message);
    if (!validation.valid) return enterIrrelevantInputGuard(context, "invalid_edit_reason");
    patch = { reason: validation.value };
  } else {
    return transitionAndPrompt(context, APPOINTMENT_STATES.EDIT_MENU, {
      editTarget: null,
      emitDraft: false,
    });
  }

  const draft = await updateAppointmentDraft(context.session, patch);
  return transitionAndPrompt(context, getNextIncompleteAppointmentState(draft), {
    draft,
    editTarget: null,
  });
};

export const handleBookingComplete = async (context) => {
  const completionFromState =
    context.session.current_step || APPOINTMENT_STATES.CONFIRM_BOOKING;
  const draft = getSessionDraft(context.session);
  if (!hasRequiredBookingEmail(draft)) {
    return transitionAndPrompt(context, APPOINTMENT_STATES.COLLECT_EMAIL, {
      draft: { ...draft, email: null, emailCollectedInSession: false },
      lastValidState: APPOINTMENT_STATES.COLLECT_EMAIL,
    });
  }
  const required = ["name", "email", "doctorId", "doctorName", "date", "time", "reason"];
  const missing = required.filter((field) => !draft[field]);
  if (missing.length) {
    emitAppointmentEvent(context.tenantId, "appointment_failed", context.session, {
      reason: `Missing fields: ${missing.join(", ")}`,
    });
    return makeResult({
      payload: buildTextPayload(context.userPhone, "Some appointment details are missing. Please review and confirm again."),
      session: context.session,
    });
  }

  const doctor = await getDoctorById(context.tenantId, draft.doctorId);
  if (!doctor) {
    emitAppointmentEvent(context.tenantId, "appointment_failed", context.session, {
      reason: "doctor_unavailable",
    });
    return makeResult({
      payload: buildTextPayload(context.userPhone, "The selected doctor is no longer available. Please choose another doctor."),
      session: context.session,
    });
  }

  const slotAllowed = await isSlotLockedBySessionOrAvailable({
    tenantId: context.tenantId,
    doctorId: draft.doctorId,
    date: draft.date,
    time: draft.time,
    sessionId: context.session.session_id,
  });
  const dbAvailable = await checkAvailabilityService(
    context.tenantId,
    draft.doctorId,
    draft.date,
    draft.time,
  );
  if (!slotAllowed || !dbAvailable) {
    await releaseLockedSlots(context.session.session_id);
    const nextDraft = clearSlotSelectionFromDraft({ ...draft, time: null });
    context.session = await transitionAppointmentState({
      session: context.session,
      toState: APPOINTMENT_STATES.SELECT_TIME,
      draft: nextDraft,
      lastValidState: APPOINTMENT_STATES.SELECT_TIME,
    });
    return makeResult({
      payload: buildTextPayload(context.userPhone, "Sorry, this slot is no longer available. Please choose another time."),
      session: context.session,
    });
  }

  const appointment = await createAppointmentService({
    tenant_id: context.tenantId,
    contact_id: context.contact?.contact_id,
    doctor_id: draft.doctorId,
    patient_name: draft.name,
    contact_number: context.contact?.phone || context.userPhone,
    country_code: context.contact?.country_code || "+91",
    appointment_date: draft.date,
    appointment_time: draft.time,
    notes: draft.reason,
    email: draft.email,
    age: context.contact?.age || null,
    status: "Pending",
    send_creation_email: false,
  });

  await markSlotBooked({
    tenantId: context.tenantId,
    session: context.session,
    doctorId: draft.doctorId,
    date: draft.date,
    time: draft.time,
    appointmentId: appointment.appointment_id,
  });

  context.session = await completeAppointmentSession(context.session);
  await logTransition(context, completionFromState, null);
  emitAppointmentEvent(context.tenantId, "appointment_confirmed", context.session, {
    appointmentId: appointment.appointment_id,
    tokenNumber: appointment.token_number,
  });
  emitAppointmentEvent(context.tenantId, "appointment:created", context.session, {
    appointment_id: appointment.appointment_id,
    patient_name: appointment.patient_name,
    doctor_name: draft.doctorName,
    appointment_date: appointment.appointment_date,
    appointment_time: appointment.appointment_time,
    token_number: appointment.token_number,
  });

  return makeResult({
    payload: buildSuccessPayload(context.userPhone, appointment),
    session: context.session,
    event: "appointment_confirmed",
    appointment,
  });
};

export const handleAwaitingResumeDecision = async (context) => {
  if (context.decodedReply.type === APPOINTMENT_REPLY_TYPES.CONTINUE_APPOINTMENT) {
    const restoreState =
      context.session.last_valid_state || APPOINTMENT_STATES.COLLECT_NAME;
    context.session = await transitionAppointmentState({
      session: context.session,
      toState: restoreState,
      lastValidState: restoreState,
      refreshTimeout: true,
    });
    await logTransition(context, APPOINTMENT_STATES.AWAITING_RESUME_DECISION, restoreState);
    return sendStatePrompt(context, restoreState);
  }

  if (context.decodedReply.type === APPOINTMENT_REPLY_TYPES.CANCEL_BOOKING) {
    return cancelSessionAndRespond(context);
  }

  return makeResult({
    payload: buildAppointmentResumeCancelPayload(context.userPhone, context.session.last_valid_state),
    session: context.session,
  });
};

export const STATE_HANDLERS = {
  [APPOINTMENT_STATES.COLLECT_NAME]: handleCollectName,
  [APPOINTMENT_STATES.COLLECT_EMAIL]: handleCollectEmail,
  [APPOINTMENT_STATES.SELECT_DOCTOR]: handleSelectDoctor,
  [APPOINTMENT_STATES.SELECT_DATE]: handleSelectDate,
  [APPOINTMENT_STATES.SELECT_TIME]: handleSelectTime,
  [APPOINTMENT_STATES.COLLECT_REASON]: handleCollectReason,
  [APPOINTMENT_STATES.CONFIRM_BOOKING]: handleConfirmBooking,
  [APPOINTMENT_STATES.EDIT_MENU]: handleEditMenu,
  [APPOINTMENT_STATES.EDIT_FIELD]: handleEditField,
  [APPOINTMENT_STATES.BOOKING_COMPLETE]: handleBookingComplete,
  [APPOINTMENT_STATES.AWAITING_RESUME_DECISION]: handleAwaitingResumeDecision,
};

export const handleAdvancedAppointmentBooking = async ({
  tenantId,
  userPhone,
  contact,
  message,
  interactiveReplyId,
  whatsappMessageId,
}) => {
  const contactId = contact?.contact_id;
  const decodedReply = decodeAppointmentReply(interactiveReplyId || message);
  const isDoctorSelectionStart =
    decodedReply.type === APPOINTMENT_REPLY_TYPES.DOCTOR_SELECTED;
  let session = await getActiveAppointmentSession({ tenantId, contactId, userPhone });
  const needsActiveBookingSession = isSessionRequiredBookingReply(
    decodedReply,
    interactiveReplyId,
  );

  if (session && isSessionExpired(session)) {
    const previousState = session.current_step;
    await releaseLockedSlots(session.session_id);
    session = await expireAppointmentSession(session);
    await logAppointmentStateTransition({
      tenantId,
      userPhone,
      sessionId: session.session_id,
      fromState: previousState,
      toState: null,
      message,
      replyId: interactiveReplyId,
      whatsappMessageId,
    });
    emitAppointmentEvent(tenantId, "appointment_expired", session, {
      previousState,
      expiredAt: new Date(),
    });
    return makeBookingSessionExpiredResult({
      tenantId,
      userPhone,
      session,
      message,
      replyId: interactiveReplyId,
      whatsappMessageId,
      reason: "expired_booking_session",
    });
  }

  if (whatsappMessageId) {
    const alreadyProcessed = await hasProcessedAppointmentMessage(
      tenantId,
      whatsappMessageId,
    );
    if (alreadyProcessed) {
      return makeDuplicateBookingMessageResult(session);
    }
  }

  if (!session && needsActiveBookingSession) {
    return makeBookingSessionExpiredResult({
      tenantId,
      userPhone,
      message,
      replyId: interactiveReplyId,
      whatsappMessageId,
      reason: "missing_active_booking_session",
    });
  }

  const { session: activeSession, created } = await getOrCreateAppointmentSession({
    tenantId,
    contactId,
    userPhone,
    initialState: isDoctorSelectionStart
      ? APPOINTMENT_STATES.SELECT_DOCTOR
      : APPOINTMENT_STATES.COLLECT_NAME,
    draft: {
      name: contact?.name && contact.name !== userPhone ? contact.name : null,
      email: null,
      emailCollectedInSession: false,
    },
  });
  session = activeSession;

  const context = {
    tenantId,
    userPhone,
    contact,
    message: String(message || "").trim(),
    interactiveReplyId,
    whatsappMessageId,
    decodedReply,
    session,
  };

  if (
    decodedReply.sessionId &&
    session?.session_id &&
    decodedReply.sessionId !== session.session_id
  ) {
    return makeStaleBookingReplyResult({
      tenantId,
      userPhone,
      session,
      message,
      replyId: interactiveReplyId,
      whatsappMessageId,
      reason: "booking_session_mismatch",
    });
  }

  if (
    !created &&
    ![
      APPOINTMENT_STATES.COLLECT_NAME,
      APPOINTMENT_STATES.COLLECT_EMAIL,
      APPOINTMENT_STATES.EDIT_MENU,
      APPOINTMENT_STATES.EDIT_FIELD,
      APPOINTMENT_STATES.AWAITING_RESUME_DECISION,
      APPOINTMENT_STATES.BOOKING_COMPLETE,
    ].includes(session.current_step) &&
    !hasRequiredBookingEmail(getSessionDraft(session))
  ) {
    return transitionAndPrompt(context, APPOINTMENT_STATES.COLLECT_EMAIL, {
      draft: {
        ...getSessionDraft(session),
        email: null,
        emailCollectedInSession: false,
      },
      lastValidState: APPOINTMENT_STATES.COLLECT_EMAIL,
    });
  }

  if (
    !created &&
    interactiveReplyId &&
    !isReplyValidForBookingState({
      decodedReply,
      state: session.current_step,
    })
  ) {
    const overrideType = getInSessionBookingOverrideType({
      decodedReply,
      state: session.current_step,
    });
    if (overrideType) {
      return handleInSessionBookingOverride(context, overrideType);
    }

    await logAppointmentStateTransition({
      tenantId,
      userPhone,
      sessionId: session.session_id,
      fromState: session.current_step,
      toState: "ACTIVE_BOOKING_REPLY_REPROMPT",
      message,
      replyId: interactiveReplyId,
      whatsappMessageId,
    });
    return sendStatePrompt(context, session.current_step);
  }

  if (isCancelKeyword(message, interactiveReplyId)) {
    return cancelSessionAndRespond(context);
  }

  if (created) {
    emitAppointmentEvent(tenantId, "appointment_started", session);
    await logTransition(context, null, session.current_step);
    if (isDoctorSelectionStart) {
      return handleSelectDoctor(context);
    }
    return sendStatePrompt(context, APPOINTMENT_STATES.COLLECT_NAME);
  }

  if (
    context.decodedReply.type === APPOINTMENT_REPLY_TYPES.DOCTOR_SELECTED &&
    ![
      APPOINTMENT_STATES.AWAITING_RESUME_DECISION,
      APPOINTMENT_STATES.BOOKING_COMPLETE,
    ].includes(session.current_step)
  ) {
    return handleSelectDoctor(context);
  }

  if (
    ![
      APPOINTMENT_STATES.EDIT_MENU,
      APPOINTMENT_STATES.AWAITING_RESUME_DECISION,
      APPOINTMENT_STATES.BOOKING_COMPLETE,
    ].includes(session.current_step) &&
    context.decodedReply.type === APPOINTMENT_REPLY_TYPES.CONTINUE_APPOINTMENT
  ) {
    context.session = await transitionAppointmentState({
      session,
      toState: session.current_step,
      lastValidState: session.current_step,
      refreshTimeout: true,
    });
    return sendStatePrompt(context, context.session.current_step);
  }

  if (
    ![
      APPOINTMENT_STATES.COLLECT_NAME,
      APPOINTMENT_STATES.EDIT_MENU,
      APPOINTMENT_STATES.EDIT_FIELD,
      APPOINTMENT_STATES.AWAITING_RESUME_DECISION,
      APPOINTMENT_STATES.BOOKING_COMPLETE,
    ].includes(session.current_step) &&
    getEditTargetByReplyType(context.decodedReply.type)
  ) {
    return handleContextualEditSelection(context, session.current_step);
  }

  if (
    ![
      APPOINTMENT_STATES.COLLECT_NAME,
      APPOINTMENT_STATES.EDIT_MENU,
      APPOINTMENT_STATES.EDIT_FIELD,
      APPOINTMENT_STATES.AWAITING_RESUME_DECISION,
      APPOINTMENT_STATES.BOOKING_COMPLETE,
    ].includes(session.current_step) &&
    isEditRequest(context) &&
    hasEditablePreviousFields({
      currentState: session.current_step,
      draft: getSessionDraft(session),
    })
  ) {
    return openContextualEditMenu(context);
  }

  if (shouldMoveLegacySessionToReasonStep(session)) {
    return transitionAndPrompt(context, APPOINTMENT_STATES.COLLECT_REASON, {
      draft: getSessionDraft(session),
      emitDraft: false,
    });
  }

  const handler = STATE_HANDLERS[session.current_step] || handleCollectName;
  try {
    return await handler(context);
  } catch (err) {
    console.error("[ADV-APPT] State handler failed:", err.stack || err.message);
    emitAppointmentEvent(tenantId, "appointment_failed", session, {
      reason: err.message,
    });
    return makeResult({
      payload: buildTextPayload(userPhone, "Sorry, something went wrong while booking your appointment. Please try again."),
      session,
      event: "appointment_failed",
      extra: { error: err.message },
    });
  }
};

export const hasActiveAdvancedAppointmentSession = async ({
  tenantId,
  contactId,
  userPhone,
}) => {
  const session = await getActiveAppointmentSession({ tenantId, contactId, userPhone });
  return Boolean(session);
};

export const expireAdvancedAppointmentSessions = async () => {
  const sessions = await db.BookingSessions.findAll({
    where: {
      flow_type: "book",
      status: ADVANCED_SESSION_STATUS.IN_PROGRESS,
      expires_at: { [Op.lt]: new Date() },
    },
  });

  for (const session of sessions) {
    const previousState = session.current_step;
    await releaseLockedSlots(session.session_id);
    await expireAppointmentSession(session);
    await logAppointmentStateTransition({
      tenantId: session.tenant_id,
      userPhone: session.user_phone,
      sessionId: session.session_id,
      fromState: previousState,
      toState: null,
      message: "cron_expiry",
    });
    emitAppointmentEvent(session.tenant_id, "appointment_expired", session, {
      previousState,
      expiredAt: new Date(),
    });
  }

  return sessions.length;
};
