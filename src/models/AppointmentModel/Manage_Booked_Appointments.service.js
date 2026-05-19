import { getIO } from "../../middlewares/socket/socket.js";
import {
  buildManageAppointmentDetailsPayload,
  buildManageAppointmentSelectionPayload,
  buildManageCancelConfirmPayload,
  buildManageDateListPayload,
  buildManageEditMenuPayload,
  buildManageRescheduleConfirmPayload,
  buildManageSlotListPayload,
  buildManageTextPayload,
  buildNoManageAppointmentsPayload,
} from "./manageAppointmentTemplates.service.js";
import {
  getManageAppointmentById,
  getManageAppointmentsForUser,
  normalizeManagePhone,
  userCanAccessManageAppointment,
} from "./manageAppointmentLookup.service.js";
import {
  MANAGE_APPOINTMENT_STATES,
  MANAGE_APPOINTMENT_SESSION_STATUS,
  clearManageAppointmentSession,
  createManageAppointmentSession,
  expireManageAppointmentSession,
  getActiveManageAppointmentSession,
  getSessionAppointmentIds,
  getSessionPendingValue,
  isManageAppointmentSessionExpired,
  replaceManageAppointmentSession,
  updateManageAppointmentSession,
} from "./manageAppointmentSession.service.js";
import {
  MANAGE_APPOINTMENT_AUDIT_ACTIONS,
  logManageAppointmentAudit,
} from "./manageAppointmentAudit.service.js";
import {
  cancelManageAppointment,
  confirmManageReschedule,
  getManageAvailableDates,
  getManageAvailableSlotSelection,
  getManageSlotRows,
  lockManageRescheduleSlot,
  resolveManageSlotReply,
  updateManageAppointmentField,
  validateManageEmail,
  validateManageName,
  validateManagePhone,
  validateManageReasonWithAI,
} from "./manageAppointmentMutation.service.js";
import {
  hasManageAppointmentStartSignal,
  isManageAppointmentExitCommand,
  isManageAppointmentReplyId,
  shouldStartManageAppointmentsFlow,
} from "./manageAppointmentRoutingGuard.service.js";
import { releaseLockedSlots } from "./appointmentSlotLock.service.js";

const makeResult = ({ payload = null, payloads = null, session = null, message = null, ...rest } = {}) => ({
  payload,
  payloads,
  session,
  message:
    message ||
    payload?.text?.body ||
    payload?.interactive?.body?.text ||
    payloads?.[0]?.text?.body ||
    payloads?.[0]?.interactive?.body?.text ||
    "Appointment management updated.",
  ...rest,
});

const emitManageEvent = (tenantId, event, session, extra = {}) => {
  try {
    const io = getIO();
    io.to(`tenant-${tenantId}`).emit(event, {
      tenantId,
      sessionId: session?.session_id || null,
      state: session?.state || null,
      status: session?.status || null,
      updatedAt: new Date(),
      ...extra,
    });
  } catch (_) {}
};

const parseSelectedAppointmentId = (replyId = "") =>
  String(replyId || "").startsWith("manage_appt_select_")
    ? String(replyId).slice("manage_appt_select_".length)
    : null;

const parseSelectedDate = (replyId = "") => {
  const id = String(replyId || "");
  if (!id.startsWith("manage_appt_date_")) return null;
  const value = id.slice("manage_appt_date_".length);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

const getSelectedAppointment = async ({ tenantId, userPhone, session }) => {
  const appointmentId = session?.selected_appointment_id;
  if (!appointmentId) return null;
  const appointment = await getManageAppointmentById({ tenantId, appointmentId });
  if (!userCanAccessManageAppointment({ appointment, userPhone, session })) return null;
  return appointment;
};

const showAppointmentDetails = async ({ tenantId, userPhone, session, appointment, logViewed = true }) => {
  if (logViewed) {
    await logManageAppointmentAudit({
      appointmentId: appointment.appointment_id,
      tenantId,
      actionType: MANAGE_APPOINTMENT_AUDIT_ACTIONS.VIEWED,
      changedBy: userPhone,
    });
  }
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.DETAILS,
    selected_appointment_id: appointment.appointment_id,
    pending_edit_field: null,
    pending_edit_value: null,
    selected_date: null,
    selected_slot_id: null,
    selected_time: null,
    selected_doctor_id: appointment.doctor_id || null,
  });
  return makeResult({
    payload: await buildManageAppointmentDetailsPayload({
      tenantId,
      to: userPhone,
      appointment,
    }),
    session: nextSession,
  });
};

const startManageAppointments = async ({ tenantId, userPhone, contact }) => {
  const appointments = await getManageAppointmentsForUser({ tenantId, userPhone });
  const appointmentIds = appointments.map((appointment) => appointment.appointment_id);

  if (!appointments.length) {
    const session = await replaceManageAppointmentSession({
      tenantId,
      userPhone,
      contactId: contact?.contact_id || null,
      state: MANAGE_APPOINTMENT_STATES.SELECT_APPOINTMENT,
      appointmentIds,
      appointmentCount: 0,
    });
    return makeResult({
      payload: buildNoManageAppointmentsPayload(userPhone),
      session,
      event: "manage_appointment_empty",
    });
  }

  if (appointments.length === 1) {
    const session = await replaceManageAppointmentSession({
      tenantId,
      userPhone,
      contactId: contact?.contact_id || null,
      state: MANAGE_APPOINTMENT_STATES.DETAILS,
      appointmentIds,
      appointmentCount: 1,
      selectedAppointmentId: appointments[0].appointment_id,
    });
    emitManageEvent(tenantId, "manage_appointment_started", session, { appointmentCount: 1 });
    return showAppointmentDetails({ tenantId, userPhone, session, appointment: appointments[0] });
  }

  const session = await replaceManageAppointmentSession({
    tenantId,
    userPhone,
    contactId: contact?.contact_id || null,
    state: MANAGE_APPOINTMENT_STATES.SELECT_APPOINTMENT,
    appointmentIds,
    appointmentCount: appointments.length,
    currentPage: 0,
  });
  emitManageEvent(tenantId, "manage_appointment_started", session, {
    appointmentCount: appointments.length,
  });
  return makeResult({
    payload: buildManageAppointmentSelectionPayload({
      to: userPhone,
      appointments,
      page: 0,
    }),
    session,
  });
};

const handleAppointmentSelection = async ({ tenantId, userPhone, session, appointmentId }) => {
  const validIds = getSessionAppointmentIds(session);
  if (!validIds.includes(appointmentId)) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "That appointment selection is no longer valid. Please ask to view your appointments again."),
      session,
    });
  }

  const appointment = await getManageAppointmentById({ tenantId, appointmentId });
  if (!userCanAccessManageAppointment({ appointment, userPhone, session })) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment for your WhatsApp number."),
      session,
    });
  }

  return showAppointmentDetails({ tenantId, userPhone, session, appointment });
};

const handleNextPage = async ({ tenantId, userPhone, session }) => {
  const appointments = await getManageAppointmentsForUser({ tenantId, userPhone });
  const appointmentIds = appointments.map((appointment) => appointment.appointment_id);
  const currentPage = Number(session.current_page || 0) + 1;
  const maxPage = Math.max(0, Math.ceil(appointments.length / 8) - 1);
  const nextPage = currentPage > maxPage ? 0 : currentPage;
  const nextSession = await updateManageAppointmentSession(session, {
    appointment_count: appointments.length,
    appointment_ids: appointmentIds,
    current_page: nextPage,
    state: MANAGE_APPOINTMENT_STATES.SELECT_APPOINTMENT,
  });
  return makeResult({
    payload: buildManageAppointmentSelectionPayload({
      to: userPhone,
      appointments,
      page: nextPage,
    }),
    session: nextSession,
  });
};

const handleEditFieldValue = async ({ tenantId, userPhone, session, message }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment) {
    await clearManageAppointmentSession(session, MANAGE_APPOINTMENT_SESSION_STATUS.CANCELLED);
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
      session,
    });
  }

  const field = session.pending_edit_field;
  let validation;
  let auditAction;
  let oldValue;
  let newValue;

  if (field === "name") {
    validation = validateManageName(message);
    auditAction = MANAGE_APPOINTMENT_AUDIT_ACTIONS.UPDATED_NAME;
    oldValue = { patient_name: appointment.patient_name };
    newValue = { patient_name: validation.value };
  } else if (field === "phone") {
    validation = validateManagePhone(message);
    auditAction = MANAGE_APPOINTMENT_AUDIT_ACTIONS.UPDATED_PHONE;
    oldValue = { country_code: appointment.country_code, contact_number: appointment.contact_number };
    newValue = validation.value;
  } else if (field === "email") {
    validation = validateManageEmail(message);
    auditAction = MANAGE_APPOINTMENT_AUDIT_ACTIONS.UPDATED_EMAIL;
    oldValue = { email: appointment.email };
    newValue = { email: validation.value };
  } else if (field === "reason") {
    validation = await validateManageReasonWithAI({ tenantId, reason: message });
    auditAction = MANAGE_APPOINTMENT_AUDIT_ACTIONS.UPDATED_REASON;
    oldValue = { notes: appointment.notes, service_name: appointment.service_name };
    newValue = { notes: validation.value, service_name: validation.value };
  } else {
    return makeResult({ payload: buildManageEditMenuPayload(userPhone), session });
  }

  if (!validation.valid) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, validation.reason || "Please send a valid value."),
      session,
    });
  }

  await updateManageAppointmentField({ tenantId, appointment, field, value: validation.value });
  await logManageAppointmentAudit({
    appointmentId: appointment.appointment_id,
    tenantId,
    actionType: auditAction,
    oldValue,
    newValue,
    changedBy: userPhone,
  });

  const updated = await getManageAppointmentById({ tenantId, appointmentId: appointment.appointment_id });
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.DETAILS,
    pending_edit_field: null,
    pending_edit_value: null,
  });

  return makeResult({
    payloads: [
      buildManageTextPayload(userPhone, "Appointment details updated successfully."),
      await buildManageAppointmentDetailsPayload({ tenantId, to: userPhone, appointment: updated }),
    ],
    session: nextSession,
  });
};

const handleRescheduleStart = async ({ tenantId, userPhone, session }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
      session,
    });
  }
  if (!appointment.doctor_id) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "This appointment does not have an assigned doctor, so it can’t be re-scheduled from WhatsApp."),
      session,
    });
  }

  const dates = await getManageAvailableDates({ tenantId, appointment, session });
  if (!dates.length) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "No re-schedule dates are currently available for this doctor."),
      session,
    });
  }
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.SELECT_DATE,
    selected_date: null,
    selected_time: null,
    selected_slot_id: null,
    selected_doctor_id: appointment.doctor_id,
    pending_edit_value: null,
  });
  return makeResult({
    payload: buildManageDateListPayload(userPhone, dates),
    session: nextSession,
  });
};

const handleDateSelection = async ({ tenantId, userPhone, session, date }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment || !date) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "Please choose a valid date from the list."),
      session,
    });
  }
  await releaseLockedSlots(session.session_id);
  const slotSelection = await getManageAvailableSlotSelection({ tenantId, appointment, session, date });
  const slotRows = getManageSlotRows(slotSelection);
  if (!slotRows.rows.length) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "No slots are available for this date. Please choose another date."),
      session,
    });
  }
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.SELECT_TIME,
    selected_date: date,
    selected_time: null,
    selected_slot_id: null,
    pending_edit_value: { slotSelection },
  });
  return makeResult({
    payload: buildManageSlotListPayload(userPhone, slotRows.rows, slotRows.bodyText, slotRows.sectionTitle),
    session: nextSession,
  });
};

const handleSlotSelection = async ({ tenantId, userPhone, session, replyId }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  const pending = getSessionPendingValue(session) || {};
  const slotSelection = pending.slotSelection || null;
  const resolved = resolveManageSlotReply(replyId, slotSelection);

  if (resolved?.type === "group") {
    const nextSlotSelection = { ...slotSelection, selectedGroupId: resolved.group.id };
    const slotRows = getManageSlotRows(nextSlotSelection, resolved.group.id);
    const nextSession = await updateManageAppointmentSession(session, {
      pending_edit_value: { slotSelection: nextSlotSelection },
    });
    return makeResult({
      payload: buildManageSlotListPayload(userPhone, slotRows.rows, slotRows.bodyText, slotRows.sectionTitle),
      session: nextSession,
    });
  }

  if (!appointment || resolved?.type !== "slot") {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "Please choose a valid time slot from the list."),
      session,
    });
  }

  const date = session.selected_date;
  const time = resolved.slot.time;
  const lockedSlot = await lockManageRescheduleSlot({ tenantId, session, appointment, date, time });
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.CONFIRM_RESCHEDULE,
    selected_time: time,
    selected_slot_id: lockedSlot?.id ? String(lockedSlot.id) : resolved.slot.id,
    pending_edit_value: null,
  });

  return makeResult({
    payload: buildManageRescheduleConfirmPayload({
      to: userPhone,
      oldAppointment: appointment,
      newDate: date,
      newTime: time,
      newDoctorName: appointment.doctor?.name,
    }),
    session: nextSession,
  });
};

const handleConfirmReschedule = async ({ tenantId, userPhone, session }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
      session,
    });
  }
  const oldValue = {
    appointment_date: appointment.appointment_date,
    appointment_time: appointment.appointment_time,
    doctor_id: appointment.doctor_id,
    status: appointment.status,
  };
  const updated = await confirmManageReschedule({ tenantId, session, appointment });
  await logManageAppointmentAudit({
    appointmentId: appointment.appointment_id,
    tenantId,
    actionType: MANAGE_APPOINTMENT_AUDIT_ACTIONS.RESCHEDULED,
    oldValue,
    newValue: {
      appointment_date: updated.appointment_date,
      appointment_time: updated.appointment_time,
      doctor_id: updated.doctor_id,
      status: updated.status,
    },
    changedBy: userPhone,
  });
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.DETAILS,
    selected_date: null,
    selected_time: null,
    selected_slot_id: null,
    pending_edit_value: null,
  });
  return makeResult({
    payloads: [
      buildManageTextPayload(userPhone, "Your appointment has been re-scheduled successfully."),
      await buildManageAppointmentDetailsPayload({ tenantId, to: userPhone, appointment: updated }),
    ],
    session: nextSession,
  });
};

const handleCancelStart = async ({ tenantId, userPhone, session }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
      session,
    });
  }
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.CONFIRM_CANCEL,
  });
  return makeResult({
    payload: buildManageCancelConfirmPayload({ to: userPhone, appointment }),
    session: nextSession,
  });
};

const handleConfirmCancel = async ({ tenantId, userPhone, session }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
      session,
    });
  }
  const oldValue = {
    status: appointment.status,
    appointment_date: appointment.appointment_date,
    appointment_time: appointment.appointment_time,
  };
  await cancelManageAppointment({ tenantId, appointment, userPhone });
  await logManageAppointmentAudit({
    appointmentId: appointment.appointment_id,
    tenantId,
    actionType: MANAGE_APPOINTMENT_AUDIT_ACTIONS.CANCELLED,
    oldValue,
    newValue: { status: "Cancelled", cancelled_by: userPhone },
    changedBy: userPhone,
  });
  await releaseLockedSlots(session.session_id);
  const cleared = await clearManageAppointmentSession(session, MANAGE_APPOINTMENT_SESSION_STATUS.COMPLETED);
  return makeResult({
    payload: buildManageTextPayload(userPhone, "Your appointment has been cancelled successfully."),
    session: cleared,
    event: "manage_appointment_cancelled",
  });
};

const handleManageReply = async ({ tenantId, userPhone, contact, session, message, interactiveReplyId }) => {
  const replyId = interactiveReplyId || message;
  const normalizedMessage = String(message || "").trim().toLowerCase();

  if (isManageAppointmentExitCommand(message)) {
    await releaseLockedSlots(session.session_id);
    const cleared = await clearManageAppointmentSession(session, MANAGE_APPOINTMENT_SESSION_STATUS.CANCELLED);
    return makeResult({
      payload: buildManageTextPayload(userPhone, "Exited appointment management."),
      session: cleared,
    });
  }

  if (
    !interactiveReplyId &&
    session.state !== MANAGE_APPOINTMENT_STATES.AWAITING_EDIT_VALUE &&
    hasManageAppointmentStartSignal(message) &&
    !["edit appointment", "reschedule appointment", "re-schedule appointment", "cancel appointment"].includes(normalizedMessage)
  ) {
    await releaseLockedSlots(session.session_id);
    return startManageAppointments({ tenantId, userPhone, contact });
  }

  if (replyId === "manage_appt_book_new") {
    await clearManageAppointmentSession(session, MANAGE_APPOINTMENT_SESSION_STATUS.COMPLETED);
    return { handoverToBooking: true };
  }

  if (replyId === "manage_appt_main_menu" || replyId === "manage_appt_back_main") {
    await releaseLockedSlots(session.session_id);
    const cleared = await clearManageAppointmentSession(session, MANAGE_APPOINTMENT_SESSION_STATUS.COMPLETED);
    return makeResult({
      payload: buildManageTextPayload(userPhone, "You’re back at the main menu. How can I help you today?"),
      session: cleared,
    });
  }

  if (replyId === "manage_appt_next_page") {
    return handleNextPage({ tenantId, userPhone, session });
  }

  const selectedId = parseSelectedAppointmentId(replyId);
  if (selectedId) {
    return handleAppointmentSelection({ tenantId, userPhone, session, appointmentId: selectedId });
  }

  if (replyId === "manage_appt_back_details") {
    await releaseLockedSlots(session.session_id);
    const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
    if (!appointment) return startManageAppointments({ tenantId, userPhone, contact });
    return showAppointmentDetails({ tenantId, userPhone, session, appointment, logViewed: false });
  }

  if (replyId === "manage_appt_edit") {
    const nextSession = await updateManageAppointmentSession(session, {
      state: MANAGE_APPOINTMENT_STATES.EDIT_MENU,
      pending_edit_field: null,
    });
    return makeResult({ payload: buildManageEditMenuPayload(userPhone), session: nextSession });
  }

  if (normalizedMessage === "edit appointment") {
    const nextSession = await updateManageAppointmentSession(session, {
      state: MANAGE_APPOINTMENT_STATES.EDIT_MENU,
      pending_edit_field: null,
    });
    return makeResult({ payload: buildManageEditMenuPayload(userPhone), session: nextSession });
  }

  const editFieldMap = {
    manage_appt_edit_name: { field: "name", prompt: "Please type the updated patient name." },
    manage_appt_edit_phone: { field: "phone", prompt: "Please type the updated phone number." },
    manage_appt_edit_email: { field: "email", prompt: "Please type the updated email address." },
    manage_appt_edit_reason: { field: "reason", prompt: "Please type the updated reason for visit." },
  };

  if (editFieldMap[replyId]) {
    const nextSession = await updateManageAppointmentSession(session, {
      state: MANAGE_APPOINTMENT_STATES.AWAITING_EDIT_VALUE,
      pending_edit_field: editFieldMap[replyId].field,
      pending_edit_value: null,
    });
    return makeResult({
      payload: buildManageTextPayload(userPhone, editFieldMap[replyId].prompt),
      session: nextSession,
    });
  }

  if (session.state === MANAGE_APPOINTMENT_STATES.AWAITING_EDIT_VALUE) {
    return handleEditFieldValue({ tenantId, userPhone, session, message });
  }

  if (replyId === "manage_appt_reschedule" || normalizedMessage === "reschedule appointment" || normalizedMessage === "re-schedule appointment") {
    return handleRescheduleStart({ tenantId, userPhone, session });
  }

  const selectedDate = parseSelectedDate(replyId);
  if (selectedDate) {
    return handleDateSelection({ tenantId, userPhone, session, date: selectedDate });
  }

  if (String(replyId || "").startsWith("manage_appt_slot_")) {
    return handleSlotSelection({ tenantId, userPhone, session, replyId });
  }

  if (replyId === "manage_appt_confirm_reschedule") {
    return handleConfirmReschedule({ tenantId, userPhone, session });
  }

  if (replyId === "manage_appt_cancel" || normalizedMessage === "cancel appointment") {
    return handleCancelStart({ tenantId, userPhone, session });
  }

  if (replyId === "manage_appt_confirm_cancel") {
    return handleConfirmCancel({ tenantId, userPhone, session });
  }

  return makeResult({
    payload: buildManageTextPayload(userPhone, "Please choose an option from the appointment menu."),
    session,
  });
};

export const handleManageBookedAppointments = async ({
  tenantId,
  userPhone,
  contact = null,
  message = "",
  interactiveReplyId = null,
  intent = null,
} = {}) => {
  const normalizedPhone = normalizeManagePhone(userPhone);
  if (!tenantId || !normalizedPhone) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify your WhatsApp number for appointment management."),
    });
  }

  let session = await getActiveManageAppointmentSession({
    tenantId,
    userPhone: normalizedPhone,
  });

  if (session && isManageAppointmentSessionExpired(session)) {
    await releaseLockedSlots(session.session_id);
    await expireManageAppointmentSession(session);
    return { handoverToNormalRouter: true, expired: true };
  }

  if (!session) {
    const shouldStart =
      isManageAppointmentReplyId(interactiveReplyId) ||
      interactiveReplyId === "view_my_appointments" ||
      shouldStartManageAppointmentsFlow({ intent, message, interactiveReplyId }) ||
      hasManageAppointmentStartSignal(message);

    if (!shouldStart) return { handoverToNormalRouter: true };

    return startManageAppointments({ tenantId, userPhone: normalizedPhone, contact });
  }

  return handleManageReply({
    tenantId,
    userPhone: normalizedPhone,
    contact,
    session,
    message,
    interactiveReplyId,
  });
};

export const hasActiveManageAppointmentSession = async ({ tenantId, userPhone }) => {
  const normalizedPhone = normalizeManagePhone(userPhone);
  const session = await getActiveManageAppointmentSession({ tenantId, userPhone: normalizedPhone });
  return Boolean(session && !isManageAppointmentSessionExpired(session));
};

export const expireManageAppointmentSessions = async () => {
  const { expireOldManageAppointmentSessions } = await import("./manageAppointmentSession.service.js");
  return expireOldManageAppointmentSessions();
};
