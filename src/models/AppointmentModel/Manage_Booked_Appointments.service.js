import { getIO } from "../../middlewares/socket/socket.js";
import {
  buildManageAppointmentDetailsPayload,
  buildManageAppointmentSelectionPayload,
  buildManageCancelConfirmPayload,
  buildManageDateListPayload,
  buildManageDoctorListPayload,
  buildManageEditMenuPayload,
  buildManageReasonServiceListPayload,
  buildManageRescheduleConfirmPayload,
  buildManageSessionExpiredPayload,
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
  isManageEditInputState,
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
  confirmManageScheduleEdit,
  confirmManageReschedule,
  getManageDoctorsForService,
  getManageReasonServiceById,
  getManageReasonServices,
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
import {
  hasProcessedAppointmentMessage,
  logAppointmentStateTransition,
} from "./appointmentStateLog.service.js";

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
  const prefix = id.startsWith("manage_appt_date_")
    ? "manage_appt_date_"
    : id.startsWith("date_")
      ? "date_"
      : null;
  if (!prefix) return null;
  const value = id.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

const parseSelectedReasonServiceId = (replyId = "") =>
  String(replyId || "").startsWith("manage_appt_reason_")
    ? String(replyId).slice("manage_appt_reason_".length)
    : String(replyId || "").startsWith("reason_")
      ? String(replyId).slice("reason_".length)
    : null;

const parseSelectedDoctorId = (replyId = "") =>
  String(replyId || "").startsWith("manage_appt_doctor_")
    ? String(replyId).slice("manage_appt_doctor_".length)
    : String(replyId || "").startsWith("doctor_")
      ? String(replyId).slice("doctor_".length)
    : null;

const normalizeManageSlotReplyId = (replyId = "") => {
  const id = String(replyId || "").trim();
  if (id.startsWith("manage_appt_slot_")) return id;
  if (id.startsWith("slot_")) return `manage_appt_slot_${id.slice("slot_".length)}`;
  if (id.startsWith("SLOT_")) return `manage_appt_slot_${id.slice("SLOT_".length)}`;
  return id;
};

const MANAGE_EDIT_ACTION = "EDIT_APPOINTMENT";

const MANAGE_EDIT_FIELD_BY_REPLY_ID = {
  manage_appt_edit_name: "name",
  manage_appt_edit_phone: "phone",
  manage_appt_edit_email: "email",
  manage_appt_edit_reason: "reason",
  manage_appt_edit_service: "service",
  manage_appt_edit_doctor: "doctor",
  manage_appt_edit_date: "date",
  manage_appt_edit_time: "time",
};

const MANAGE_EDIT_FIELD_PROMPTS = {
  name: "Please type the updated patient name.",
  phone: "Please type the updated phone number.",
  email: "Please type the updated email address.",
};

const MANAGE_EDIT_TEXT_BY_FIELD = {
  name: ["patient name", "name", "update patient name"],
  phone: ["phone number", "phone", "mobile", "update phone number"],
  email: ["email", "mail", "gmail", "email address", "update email address"],
  reason: ["reason for visit", "reason", "visit reason", "update visit reason"],
  service: ["service", "select service", "select service reason"],
  doctor: ["doctor", "choose another doctor", "new doctor"],
  date: ["date", "appointment date", "choose a new date", "new date"],
  time: ["time slot", "time", "choose a new time", "new time"],
};

const EDIT_WAITING_STATE_BY_FIELD = {
  name: MANAGE_APPOINTMENT_STATES.WAITING_FOR_NAME_UPDATE,
  email: MANAGE_APPOINTMENT_STATES.WAITING_FOR_EMAIL_UPDATE,
  phone: MANAGE_APPOINTMENT_STATES.WAITING_FOR_PHONE_UPDATE,
  reason: MANAGE_APPOINTMENT_STATES.WAITING_FOR_REASON_UPDATE,
  doctor: MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE,
  service: MANAGE_APPOINTMENT_STATES.WAITING_FOR_SERVICE_UPDATE,
  date: MANAGE_APPOINTMENT_STATES.WAITING_FOR_DATE_UPDATE,
  time: MANAGE_APPOINTMENT_STATES.WAITING_FOR_SLOT_UPDATE,
};

const buildManageEditPendingValue = (patch = {}) => ({
  mode: "MANAGE_APPOINTMENT",
  action: MANAGE_EDIT_ACTION,
  ...patch,
});

export const isManageScheduleEditPending = (pending = {}) =>
  pending?.mode === "MANAGE_APPOINTMENT" &&
  pending?.action === MANAGE_EDIT_ACTION &&
  ["time", "date", "doctor", "service", "reason"].includes(pending?.editField);

const isManageEditPending = (pending = {}) =>
  pending?.mode === "MANAGE_APPOINTMENT" &&
  pending?.action === MANAGE_EDIT_ACTION;

const isManageState = (session, states = []) =>
  states.includes(session?.state);

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
};

const normalizeSelectionText = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/\bdr\.?\b/g, "")
    .replace(/[^a-z0-9:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getManageEditStep = (session = null) => {
  if (!session) return null;
  return session.state || null;
};

const logManageEditTransition = ({
  session = null,
  replyId = null,
  message = null,
  nextStep = null,
  extra = {},
} = {}) => {
  const pending = getSessionPendingValue(session) || {};
  try {
    console.log(
      "[ManageAppointmentEdit]",
      JSON.stringify({
        appointmentId: session?.selected_appointment_id || pending.appointmentId || null,
        currentStep: getManageEditStep(session),
        replyId: replyId || null,
        message: message || null,
        editField: pending.editField || session?.pending_edit_field || null,
        nextStep,
        selectedDoctor: session?.selected_doctor_id || pending.doctorId || null,
        selectedDate: session?.selected_date || null,
        selectedSlot: session?.selected_slot_id || null,
        ...extra,
      }),
    );
  } catch (_) {}
};

const logManageDoctorEditDebug = ({
  event,
  session = null,
  replyId = null,
  message = null,
  interactiveReplyId = null,
  pending = null,
  extra = {},
} = {}) => {
  try {
    const currentPending = pending || getSessionPendingValue(session) || {};
    console.log(
      "[ManageAppointmentDoctorEdit]",
      JSON.stringify({
        event,
        sessionId: session?.session_id || null,
        appointmentId: session?.selected_appointment_id || currentPending.appointmentId || null,
        state: session?.state || null,
        status: session?.status || null,
        replyId: replyId || null,
        message: message || null,
        interactiveReplyId: interactiveReplyId || null,
        pendingEditField: session?.pending_edit_field || null,
        pendingAction: currentPending.action || null,
        pendingMode: currentPending.mode || null,
        pendingEditValueField: currentPending.editField || null,
        pendingServiceId: currentPending.serviceId || null,
        pendingDoctorId: currentPending.doctorId || null,
        selectedDoctorId: session?.selected_doctor_id || null,
        selectedDate: session?.selected_date || null,
        selectedSlotId: session?.selected_slot_id || null,
        ...extra,
      }),
    );
  } catch (_) {}
};

const appointmentDateOnly = (appointment) =>
  String(appointment?.appointment_date || "").slice(0, 10);

export const getManageEditFieldFromReplyId = (replyId = "") =>
  MANAGE_EDIT_FIELD_BY_REPLY_ID[String(replyId || "")] || null;

export const resolveManageEditFieldReplyIdFromText = (message = "") => {
  const text = normalizeSelectionText(message);
  if (!text) return null;
  for (const [field, labels] of Object.entries(MANAGE_EDIT_TEXT_BY_FIELD)) {
    if (
      labels.some((label) => {
        const normalizedLabel = normalizeSelectionText(label);
        return text === normalizedLabel || text.includes(normalizedLabel);
      })
    ) {
      return `manage_appt_edit_${field}`;
    }
  }
  return null;
};

export const getManageEditableFieldsForAppointment = (appointment = null) => {
  if (!appointment) return [];
  const fields = ["name", "email", "reason", "service", "doctor"];
  if (hasValue(appointment.doctor_id)) fields.push("date");
  if (hasValue(appointment.doctor_id) && hasValue(appointmentDateOnly(appointment))) {
    fields.push("time");
  }
  return fields;
};

export const buildManageEditRowsForAppointment = (appointment = null) => {
  const fields = new Set(getManageEditableFieldsForAppointment(appointment));
  const rows = [
    fields.has("name") && { id: "manage_appt_edit_name", title: "Patient Name", description: "Update patient name" },
    fields.has("email") && { id: "manage_appt_edit_email", title: "Email", description: "Update email address" },
    fields.has("reason") && { id: "manage_appt_edit_reason", title: "Reason for Visit", description: "Update visit reason" },
    fields.has("service") && { id: "manage_appt_edit_service", title: "Service", description: "Select service/reason" },
    fields.has("doctor") && { id: "manage_appt_edit_doctor", title: "Doctor", description: "Choose another doctor" },
    fields.has("date") && { id: "manage_appt_edit_date", title: "Date", description: "Choose a new date" },
    fields.has("time") && { id: "manage_appt_edit_time", title: "Time Slot", description: "Choose a new time" },
    { id: "manage_appt_back_details", title: "Back", description: "Return to details" },
  ];
  return rows.filter(Boolean);
};

export const isManageEditFieldAllowed = ({ appointment = null, field = null, replyId = null } = {}) => {
  const targetField = field || getManageEditFieldFromReplyId(replyId);
  if (!targetField) return false;
  return getManageEditableFieldsForAppointment(appointment).includes(targetField);
};

export const resolveManageDoctorReplyIdFromText = (message = "", doctors = []) => {
  const text = normalizeSelectionText(message);
  if (!text) return null;
  const matched = (doctors || []).find((doctor) => {
    const doctorName = normalizeSelectionText(doctor?.name || "");
    const doctorTitle = normalizeSelectionText(`Dr. ${doctor?.name || ""}`);
    const specs = normalizeSelectionText(
      (doctor?.specializations || []).map((item) => item.name).join(" "),
    );
    return (
      doctor?.doctor_id &&
      (text === doctorName ||
        text === doctorTitle ||
        text.includes(doctorName) ||
        (doctorName && doctorName.includes(text)) ||
        (doctorName && specs && text.includes(doctorName) && text.includes(specs.split(" ")[0])))
    );
  });
  return matched?.doctor_id ? `manage_appt_doctor_${matched.doctor_id}` : null;
};

export const resolveManageDateReplyIdFromText = (message = "", dates = []) => {
  const text = normalizeSelectionText(message);
  if (!text) return null;
  const matched = (dates || []).find((date) => {
    const value = normalizeSelectionText(date?.value || "");
    const label = normalizeSelectionText(date?.label || "");
    const description = normalizeSelectionText(date?.description || "");
    return (
      date?.value &&
      (text === value ||
        text === label ||
        text === description ||
        text.includes(value) ||
        text.includes(label) ||
        text.includes(description))
    );
  });
  return matched?.value ? `manage_appt_date_${matched.value}` : null;
};

export const resolveManageSlotReplyIdFromText = (message = "", slotSelection = null) => {
  const text = normalizeSelectionText(message);
  if (!text) return null;
  const group = (slotSelection?.groupedSlots || []).find((item) => {
    const title = normalizeSelectionText(item?.title || "");
    return item?.id && (text === title || text.includes(title));
  });
  if (group?.id) return group.id;

  const slots = [
    ...(slotSelection?.availableSlots || []),
    ...((slotSelection?.groupedSlots || []).flatMap((item) => item.slots || [])),
  ];
  const matched = slots.find((slot) => {
    const time = normalizeSelectionText(slot?.time || "");
    const title = normalizeSelectionText(slot?.title || "");
    return slot?.id && (text === time || text === title || text.includes(time));
  });
  return matched?.id || null;
};

const isActiveManageEditInputSession = (session) => {
  const pending = getSessionPendingValue(session) || {};
  return (
    session?.status === MANAGE_APPOINTMENT_SESSION_STATUS.ACTIVE &&
    (
      (pending?.mode === "MANAGE_APPOINTMENT" &&
        pending?.action === MANAGE_EDIT_ACTION) ||
      Boolean(session?.pending_edit_field)
    ) &&
    isManageEditInputState(session.state)
  );
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

const startReasonEditSelection = async ({ tenantId, userPhone, session, editField = "service" }) => {
  logManageEditTransition({
    session,
    nextStep: MANAGE_APPOINTMENT_STATES.WAITING_FOR_SERVICE_UPDATE,
    extra: { selectedEditField: editField },
  });
  const services = await getManageReasonServices(tenantId);
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.WAITING_FOR_SERVICE_UPDATE,
    pending_edit_field: "service",
    pending_edit_value: buildManageEditPendingValue({
      appointmentId: session.selected_appointment_id || null,
      editField,
    }),
  });

  if (!services.length) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "Please type the updated reason for visit."),
      session: nextSession,
    });
  }

  return makeResult({
    payload: buildManageReasonServiceListPayload(userPhone, services),
    session: nextSession,
  });
};

const startDoctorEditSelection = async ({
  tenantId,
  userPhone,
  session,
  serviceId = null,
  reason = null,
}) => {
  logManageEditTransition({
    session,
    nextStep: MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE,
    extra: { serviceId, reason },
  });
  const doctors = await getManageDoctorsForService({ tenantId, serviceId });
  if (!doctors.length) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "No doctors are available for this service right now."),
      session,
    });
  }

  const currentPending = getSessionPendingValue(session) || {};
  const pending = {
    ...currentPending,
    mode: "MANAGE_APPOINTMENT",
    action: MANAGE_EDIT_ACTION,
    appointmentId: session.selected_appointment_id || null,
    editField: ["service", "reason"].includes(currentPending.editField)
      ? currentPending.editField
      : "doctor",
    ...(serviceId ? { serviceId } : {}),
    ...(reason ? { reason } : {}),
  };
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE,
    pending_edit_field: "doctor",
    pending_edit_value: pending,
  });

  return makeResult({
    payload: buildManageDoctorListPayload(
      userPhone,
      doctors,
      serviceId
        ? "Please choose a doctor for the selected service."
        : "Please choose the updated doctor.",
    ),
    session: nextSession,
  });
};

const startDoctorEditServiceSelection = async ({ tenantId, userPhone, session }) => {
  const services = await getManageReasonServices(tenantId);
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.WAITING_FOR_SERVICE_UPDATE,
    pending_edit_field: "service",
    pending_edit_value: buildManageEditPendingValue({
      appointmentId: session.selected_appointment_id || null,
      editField: "doctor",
    }),
  });

  if (!services.length) {
    return startDoctorEditSelection({
      tenantId,
      userPhone,
      session: nextSession,
    });
  }

  return makeResult({
    payload: buildManageReasonServiceListPayload(
      userPhone,
      services,
      "Please select a service before choosing the new doctor.",
    ),
    session: nextSession,
  });
};

const showDateSelectionForDoctor = async ({ tenantId, userPhone, session, appointment }) => {
  const doctorId = session.selected_doctor_id || appointment.doctor_id;
  logManageEditTransition({
    session,
    nextStep: MANAGE_APPOINTMENT_STATES.SELECT_DATE,
    extra: { doctorId },
  });
  const dates = await getManageAvailableDates({
    tenantId,
    appointment,
    session,
    doctorId,
  });
  if (!dates.length) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "No dates are currently available for this doctor."),
      session,
    });
  }
  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.SELECT_DATE,
    selected_date: null,
    selected_time: null,
    selected_slot_id: null,
  });
  return makeResult({
    payload: buildManageDateListPayload(userPhone, dates),
    session: nextSession,
  });
};

const showSlotSelectionForDate = async ({ tenantId, userPhone, session, appointment, date }) => {
  await releaseLockedSlots(session.session_id);
  const doctorId = session.selected_doctor_id || appointment.doctor_id;
  logManageEditTransition({
    session,
    nextStep: MANAGE_APPOINTMENT_STATES.SELECT_TIME,
    extra: { doctorId, date },
  });
  const slotSelection = await getManageAvailableSlotSelection({
    tenantId,
    appointment,
    session,
    date,
    doctorId,
  });
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
    pending_edit_value: {
      ...(getSessionPendingValue(session) || {}),
      slotSelection,
    },
  });
  return makeResult({
    payload: buildManageSlotListPayload(userPhone, slotRows.rows, slotRows.bodyText, slotRows.sectionTitle),
    session: nextSession,
  });
};

const handleEditFieldValue = async ({ tenantId, userPhone, session, message }) => {
  logManageEditTransition({
    session,
    message,
    nextStep: MANAGE_APPOINTMENT_STATES.DETAILS,
  });
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
    if (!validation.valid) {
      return makeResult({
        payload: buildManageTextPayload(userPhone, validation.reason || "Please send a valid reason for visit."),
        session,
      });
    }
    return startDoctorEditSelection({
      tenantId,
      userPhone,
      session,
      reason: validation.value,
    });
  } else if (field === "service") {
    validation = await validateManageReasonWithAI({ tenantId, reason: message });
    if (!validation.valid) {
      return makeResult({
        payload: buildManageTextPayload(userPhone, validation.reason || "Please send a valid reason for visit."),
        session,
      });
    }
    return startDoctorEditSelection({
      tenantId,
      userPhone,
      session,
      reason: validation.value,
    });
  } else if (field === "doctor") {
    return startDoctorEditSelection({ tenantId, userPhone, session });
  } else {
    return showCurrentManageEditMenu({ tenantId, userPhone, session });
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
      buildManageTextPayload(userPhone, "Your appointment has been updated successfully."),
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
  return showSlotSelectionForDate({ tenantId, userPhone, session, appointment, date });
};

const getPendingWithoutSlotSelection = (session) => {
  const pending = { ...(getSessionPendingValue(session) || {}) };
  delete pending.slotSelection;
  return pending;
};

const completeManageScheduleEdit = async ({
  tenantId,
  userPhone,
  session,
  appointment,
  lockedSlot,
  resolvedSlot,
}) => {
  logManageEditTransition({
    session,
    replyId: resolvedSlot?.slot?.id || null,
    nextStep: MANAGE_APPOINTMENT_STATES.DETAILS,
    extra: { selectedSlot: resolvedSlot?.slot?.time || null },
  });
  const updatedSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.DETAILS,
    selected_time: resolvedSlot.slot.time,
    selected_slot_id: lockedSlot?.id ? String(lockedSlot.id) : resolvedSlot.slot.id,
    pending_edit_value: getPendingWithoutSlotSelection(session),
  });
  const updated = await confirmManageScheduleEdit({
    tenantId,
    session: updatedSession,
    appointment,
  });
  await logManageAppointmentAudit({
    appointmentId: appointment.appointment_id,
    tenantId,
    actionType: MANAGE_APPOINTMENT_AUDIT_ACTIONS.RESCHEDULED,
    oldValue: {
      appointment_date: appointment.appointment_date,
      appointment_time: appointment.appointment_time,
      doctor_id: appointment.doctor_id,
      notes: appointment.notes,
      service_name: appointment.service_name,
    },
    newValue: {
      appointment_date: updated.appointment_date,
      appointment_time: updated.appointment_time,
      doctor_id: updated.doctor_id,
      notes: updated.notes,
      service_name: updated.service_name,
    },
    changedBy: userPhone,
  });
  const nextSession = await updateManageAppointmentSession(updatedSession, {
    state: MANAGE_APPOINTMENT_STATES.DETAILS,
    selected_date: null,
    selected_time: null,
    selected_slot_id: null,
    pending_edit_field: null,
    pending_edit_value: null,
  });

  return makeResult({
    payloads: [
      buildManageTextPayload(userPhone, "Your appointment has been updated successfully."),
      await buildManageAppointmentDetailsPayload({ tenantId, to: userPhone, appointment: updated }),
    ],
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
      pending_edit_value: { ...pending, slotSelection: nextSlotSelection },
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
  const doctorId = session.selected_doctor_id || appointment.doctor_id;
  const lockedSlot = await lockManageRescheduleSlot({
    tenantId,
    session,
    appointment,
    date,
    time,
    doctorId,
  });
  if (isManageScheduleEditPending(pending)) {
    return completeManageScheduleEdit({
      tenantId,
      userPhone,
      session,
      appointment,
      lockedSlot,
      resolvedSlot: resolved,
    });
  }

  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.CONFIRM_RESCHEDULE,
    selected_time: time,
    selected_slot_id: lockedSlot?.id ? String(lockedSlot.id) : resolved.slot.id,
    pending_edit_value: getPendingWithoutSlotSelection(session),
  });

  return makeResult({
    payload: buildManageRescheduleConfirmPayload({
      to: userPhone,
      oldAppointment: appointment,
      newDate: date,
      newTime: time,
      newDoctorName:
        pending.doctorName ||
        (doctorId === appointment.doctor_id ? appointment.doctor?.name : null),
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

const openManageEditMenu = async ({ tenantId, userPhone, session }) => {
  logManageEditTransition({
    session,
    nextStep: MANAGE_APPOINTMENT_STATES.EDIT_MENU,
  });
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
      session,
    });
  }

  const nextSession = await updateManageAppointmentSession(session, {
    state: MANAGE_APPOINTMENT_STATES.EDIT_MENU,
    selected_doctor_id: appointment.doctor_id || null,
    selected_date: null,
    selected_time: null,
    selected_slot_id: null,
    pending_edit_field: null,
    pending_edit_value: buildManageEditPendingValue({
      appointmentId: appointment.appointment_id,
      returnState: MANAGE_APPOINTMENT_STATES.DETAILS,
    }),
  });

  return makeResult({
    payload: buildManageEditMenuPayload(userPhone, buildManageEditRowsForAppointment(appointment)),
    session: nextSession,
  });
};

const showCurrentManageEditMenu = async ({ tenantId, userPhone, session, message = "Please choose what you would like to edit." }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
      session,
    });
  }
  return makeResult({
    payload: buildManageEditMenuPayload(
      userPhone,
      buildManageEditRowsForAppointment(appointment),
    ),
    session,
    message,
  });
};

const rePromptManageEditStep = async ({ tenantId, userPhone, session, contact = null }) => {
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  const pending = getSessionPendingValue(session) || {};

  if (!appointment) {
    return startManageAppointments({ tenantId, userPhone, contact });
  }

  if (session.state === MANAGE_APPOINTMENT_STATES.WAITING_FOR_SERVICE_UPDATE) {
    return startReasonEditSelection({
      tenantId,
      userPhone,
      session,
      editField: pending.editField || session.pending_edit_field || "service",
    });
  }

  if (session.state === MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE) {
    return startDoctorEditSelection({
      tenantId,
      userPhone,
      session,
      serviceId: pending.serviceId || null,
      reason: pending.reason || null,
    });
  }

  if (
    isManageState(session, [
      MANAGE_APPOINTMENT_STATES.WAITING_FOR_DATE_UPDATE,
      MANAGE_APPOINTMENT_STATES.SELECT_DATE,
    ])
  ) {
    return showDateSelectionForDoctor({ tenantId, userPhone, session, appointment });
  }

  if (
    isManageState(session, [
      MANAGE_APPOINTMENT_STATES.WAITING_FOR_SLOT_UPDATE,
      MANAGE_APPOINTMENT_STATES.SELECT_TIME,
    ])
  ) {
    const date = session.selected_date || appointmentDateOnly(appointment);
    if (date) {
      return showSlotSelectionForDate({ tenantId, userPhone, session, appointment, date });
    }
  }

  return showCurrentManageEditMenu({ tenantId, userPhone, session });
};

const selectManageEditField = async ({ tenantId, userPhone, session, replyId }) => {
  const field = getManageEditFieldFromReplyId(replyId);
  const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
  if (!appointment) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
      session,
    });
  }

  if (!isManageEditFieldAllowed({ appointment, field })) {
    return showCurrentManageEditMenu({
      tenantId,
      userPhone,
      session,
      message: "That edit option is not available for this appointment. Please choose another field.",
    });
  }

  if (field === "reason" || field === "service") {
    return startReasonEditSelection({ tenantId, userPhone, session, editField: field });
  }

  if (field === "doctor") {
    return startDoctorEditSelection({ tenantId, userPhone, session });
  }

  if (field === "date" || field === "time") {
    const nextSession = await updateManageAppointmentSession(session, {
      state:
        field === "date"
          ? MANAGE_APPOINTMENT_STATES.WAITING_FOR_DATE_UPDATE
          : MANAGE_APPOINTMENT_STATES.WAITING_FOR_SLOT_UPDATE,
      selected_doctor_id: appointment.doctor_id || null,
      selected_date: field === "time" ? appointmentDateOnly(appointment) : null,
      selected_time: null,
      selected_slot_id: null,
      pending_edit_field: field,
      pending_edit_value: buildManageEditPendingValue({
        appointmentId: appointment.appointment_id,
        editField: field,
      }),
    });

    if (field === "time") {
      const existingDate = appointmentDateOnly(appointment);
      if (existingDate) {
        return showSlotSelectionForDate({
          tenantId,
          userPhone,
          session: nextSession,
          appointment,
          date: existingDate,
        });
      }
      return makeResult({
        payload: buildManageTextPayload(userPhone, "This appointment does not have a date to edit the time slot."),
        session: nextSession,
      });
    }

    return showDateSelectionForDoctor({
      tenantId,
      userPhone,
      session: nextSession,
      appointment,
    });
  }

  const nextSession = await updateManageAppointmentSession(session, {
    state: EDIT_WAITING_STATE_BY_FIELD[field] || MANAGE_APPOINTMENT_STATES.AWAITING_EDIT_VALUE,
    pending_edit_field: field,
    pending_edit_value: buildManageEditPendingValue({
      appointmentId: appointment.appointment_id,
      editField: field,
    }),
  });
  return makeResult({
    payload: buildManageTextPayload(userPhone, MANAGE_EDIT_FIELD_PROMPTS[field] || "Please type the updated value."),
    session: nextSession,
  });
};

const handleManageReply = async ({ tenantId, userPhone, contact, session, message, interactiveReplyId }) => {
  const replyId = interactiveReplyId || message;
  const normalizedMessage = String(message || "").trim().toLowerCase();
  const pendingAtStart = getSessionPendingValue(session) || {};
  const isEditFlow = isManageEditPending(pendingAtStart);
  const shouldLogDoctorEdit =
    String(replyId || "").includes("doctor") ||
    String(message || "").toLowerCase().includes("doctor") ||
    session?.state === MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE ||
    session?.pending_edit_field === "doctor" ||
    pendingAtStart?.editField === "doctor";

  if (shouldLogDoctorEdit) {
    logManageDoctorEditDebug({
      event: "handle_reply_start",
      session,
      replyId,
      message,
      interactiveReplyId,
      pending: pendingAtStart,
      extra: { isEditFlow },
    });
  }

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

  const editFieldReplyId =
    getManageEditFieldFromReplyId(replyId)
      ? replyId
      : !interactiveReplyId && session.state === MANAGE_APPOINTMENT_STATES.EDIT_MENU
        ? resolveManageEditFieldReplyIdFromText(message)
        : null;

  if (editFieldReplyId) {
    if (editFieldReplyId === "manage_appt_edit_doctor") {
      logManageDoctorEditDebug({
        event: "edit_field_selected",
        session,
        replyId,
        message,
        interactiveReplyId,
        pending: pendingAtStart,
        extra: { editFieldReplyId },
      });
    }
    return selectManageEditField({ tenantId, userPhone, session, replyId: editFieldReplyId });
  }

  const selectedReasonServiceId = parseSelectedReasonServiceId(replyId);
  if (selectedReasonServiceId) {
    const pending = getSessionPendingValue(session) || {};
    if (
      !isManageEditPending(pending) ||
      !isManageState(session, [MANAGE_APPOINTMENT_STATES.WAITING_FOR_SERVICE_UPDATE]) ||
      !["service", "reason"].includes(pending?.editField)
    ) {
      return rePromptManageEditStep({ tenantId, userPhone, session, contact });
    }
    const service = await getManageReasonServiceById({
      tenantId,
      serviceId: selectedReasonServiceId,
    });
    if (!service) {
      return makeResult({
        payload: buildManageTextPayload(userPhone, "That service selection is no longer available. Please choose again."),
        session,
      });
    }
    return startDoctorEditSelection({
      tenantId,
      userPhone,
      session,
      serviceId: service.specialization_id,
      reason: service.name,
    });
  }

  const currentPendingForDoctor = getSessionPendingValue(session) || {};
  const fallbackDoctorReplyId =
    !interactiveReplyId &&
    isManageEditPending(currentPendingForDoctor) &&
    session.state === MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE &&
    ["doctor", "service", "reason"].includes(currentPendingForDoctor?.editField)
      ? resolveManageDoctorReplyIdFromText(
          message,
          await getManageDoctorsForService({
            tenantId,
            serviceId: currentPendingForDoctor.serviceId || null,
          }),
        )
      : null;
  const selectedDoctorId = parseSelectedDoctorId(replyId) ||
    parseSelectedDoctorId(fallbackDoctorReplyId);
  if (fallbackDoctorReplyId || selectedDoctorId || shouldLogDoctorEdit) {
    logManageDoctorEditDebug({
      event: "doctor_reply_parsed",
      session,
      replyId,
      message,
      interactiveReplyId,
      pending: currentPendingForDoctor,
      extra: {
        fallbackDoctorReplyId,
        selectedDoctorId,
      },
    });
  }
  if (selectedDoctorId) {
    const currentPending = getSessionPendingValue(session) || {};
    if (
      !isManageEditPending(currentPending) ||
      session.state !== MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE ||
      !["doctor", "service", "reason"].includes(currentPending?.editField)
    ) {
      logManageDoctorEditDebug({
        event: "doctor_reply_reprompt_due_state_mismatch",
        session,
        replyId,
        message,
        interactiveReplyId,
        pending: currentPending,
        extra: {
          selectedDoctorId,
          isManageEditPending: isManageEditPending(currentPending),
          expectedState: MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE,
          allowedFields: ["doctor", "service", "reason"],
        },
      });
      return rePromptManageEditStep({ tenantId, userPhone, session, contact });
    }
    const doctors = await getManageDoctorsForService({
      tenantId,
      serviceId: currentPending.serviceId || null,
    });
    const selectedDoctor = doctors.find(
      (doctor) => doctor.doctor_id === selectedDoctorId,
    );
    logManageDoctorEditDebug({
      event: "doctor_catalog_checked",
      session,
      replyId,
      message,
      interactiveReplyId,
      pending: currentPending,
      extra: {
        selectedDoctorId,
        doctorsCount: doctors.length,
        doctorIds: doctors.map((doctor) => doctor.doctor_id).slice(0, 20),
        found: Boolean(selectedDoctor),
      },
    });
    if (!selectedDoctor) {
      return makeResult({
        payload: buildManageTextPayload(userPhone, "That doctor selection is no longer available. Please choose again."),
        session,
      });
    }
    const pending = {
      ...currentPending,
      mode: "MANAGE_APPOINTMENT",
      action: MANAGE_EDIT_ACTION,
      appointmentId: session.selected_appointment_id || null,
      editField: ["service", "reason"].includes(currentPending.editField)
        ? currentPending.editField
        : "doctor",
      doctorId: selectedDoctorId,
      doctorName: selectedDoctor.name || null,
    };
    const nextSession = await updateManageAppointmentSession(session, {
      state: MANAGE_APPOINTMENT_STATES.WAITING_FOR_DATE_UPDATE,
      selected_doctor_id: selectedDoctorId,
      selected_date: null,
      selected_time: null,
      selected_slot_id: null,
      pending_edit_field: "date",
      pending_edit_value: pending,
    });
    logManageDoctorEditDebug({
      event: "doctor_selected_session_updated",
      session: nextSession,
      replyId,
      message,
      interactiveReplyId,
      pending,
      extra: {
        selectedDoctorId,
        selectedDoctorName: selectedDoctor.name || null,
        nextState: MANAGE_APPOINTMENT_STATES.WAITING_FOR_DATE_UPDATE,
      },
    });
    const appointment = await getSelectedAppointment({ tenantId, userPhone, session: nextSession });
    if (!appointment) {
      return makeResult({
        payload: buildManageTextPayload(userPhone, "I couldn’t verify this appointment anymore. Please ask to view your appointments again."),
        session: nextSession,
      });
    }
    return showDateSelectionForDoctor({
      tenantId,
      userPhone,
      session: nextSession,
      appointment,
    });
  }

  if (replyId === "manage_appt_back_details") {
    await releaseLockedSlots(session.session_id);
    const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
    if (!appointment) return startManageAppointments({ tenantId, userPhone, contact });
    return showAppointmentDetails({ tenantId, userPhone, session, appointment, logViewed: false });
  }

  if (replyId === "manage_appt_edit") {
    return openManageEditMenu({ tenantId, userPhone, session });
  }

  if (normalizedMessage === "edit appointment") {
    return openManageEditMenu({ tenantId, userPhone, session });
  }

  let selectedDate = parseSelectedDate(replyId);
  if (!selectedDate && !interactiveReplyId) {
    const pending = getSessionPendingValue(session) || {};
    const canResolveDate =
      isManageEditPending(pending) &&
      isManageState(session, [
        MANAGE_APPOINTMENT_STATES.WAITING_FOR_DATE_UPDATE,
        MANAGE_APPOINTMENT_STATES.SELECT_DATE,
      ]) &&
      ["date", "doctor", "service", "reason"].includes(pending?.editField);
    if (canResolveDate) {
      const appointment = await getSelectedAppointment({ tenantId, userPhone, session });
      if (appointment) {
        const dates = await getManageAvailableDates({
          tenantId,
          appointment,
          session,
          doctorId: session.selected_doctor_id || appointment.doctor_id,
        });
        selectedDate = parseSelectedDate(
          resolveManageDateReplyIdFromText(message, dates),
        );
      }
    }
  }
  if (selectedDate) {
    const pending = getSessionPendingValue(session) || {};
    const isScheduleEdit =
      isManageEditPending(pending) &&
      isManageState(session, [
        MANAGE_APPOINTMENT_STATES.WAITING_FOR_DATE_UPDATE,
        MANAGE_APPOINTMENT_STATES.SELECT_DATE,
      ]) &&
      ["date", "doctor", "service", "reason"].includes(pending?.editField);
    const isReschedule = session.state === MANAGE_APPOINTMENT_STATES.SELECT_DATE;
    if (!isScheduleEdit && !isReschedule) {
      return rePromptManageEditStep({ tenantId, userPhone, session, contact });
    }
    return handleDateSelection({ tenantId, userPhone, session, date: selectedDate });
  }

  const pendingForSlot = getSessionPendingValue(session) || {};
  const rawSlotReplyId = String(replyId || "").trim();
  const slotReplyCandidate =
    rawSlotReplyId.startsWith("manage_appt_slot_") ||
    rawSlotReplyId.startsWith("slot_") ||
    rawSlotReplyId.startsWith("SLOT_")
      ? rawSlotReplyId
      : !interactiveReplyId
        ? resolveManageSlotReplyIdFromText(message, pendingForSlot.slotSelection)
        : null;
  const normalizedSlotReplyId = normalizeManageSlotReplyId(slotReplyCandidate);
  if (String(normalizedSlotReplyId || "").startsWith("manage_appt_slot_")) {
    const pending = getSessionPendingValue(session) || {};
    const isScheduleEdit =
      isManageEditPending(pending) &&
      isManageState(session, [
        MANAGE_APPOINTMENT_STATES.WAITING_FOR_SLOT_UPDATE,
        MANAGE_APPOINTMENT_STATES.SELECT_TIME,
      ]) &&
      ["time", "date", "doctor", "service", "reason"].includes(pending?.editField);
    const isReschedule = session.state === MANAGE_APPOINTMENT_STATES.SELECT_TIME;
    if (!isScheduleEdit && !isReschedule) {
      return rePromptManageEditStep({ tenantId, userPhone, session, contact });
    }
    return handleSlotSelection({
      tenantId,
      userPhone,
      session,
      replyId: normalizedSlotReplyId,
    });
  }

  if (isManageEditInputState(session.state)) {
    return handleEditFieldValue({ tenantId, userPhone, session, message });
  }

  if (isEditFlow) {
    return rePromptManageEditStep({ tenantId, userPhone, session, contact });
  }

  if (replyId === "manage_appt_reschedule" || normalizedMessage === "reschedule appointment" || normalizedMessage === "re-schedule appointment") {
    return handleRescheduleStart({ tenantId, userPhone, session });
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
  whatsappMessageId = null,
} = {}) => {
  const normalizedPhone = normalizeManagePhone(userPhone);
  if (!tenantId || !normalizedPhone) {
    return makeResult({
      payload: buildManageTextPayload(userPhone, "I couldn't verify your WhatsApp number for appointment management."),
    });
  }

  let session = await getActiveManageAppointmentSession({
    tenantId,
    userPhone: normalizedPhone,
  });
  const isActiveEditInput = isActiveManageEditInputSession(session);

  // Per-message dedup: prevent duplicate responses if Meta retries the webhook
  if (whatsappMessageId && !isActiveEditInput) {
    const alreadyProcessed = await hasProcessedAppointmentMessage(tenantId, whatsappMessageId);
    if (alreadyProcessed) {
      return {
        success: true,
        alreadyProcessed: true,
        duplicate: true,
        suppressResponse: true,
      };
    }
    // Claim this messageId immediately before any async work begins
    await logAppointmentStateTransition({
      tenantId,
      userPhone: normalizedPhone,
      sessionId: session?.session_id || null,
      fromState: null,
      toState: "manage_processing",
      message,
      whatsappMessageId,
    });
  }

  if (session && isManageAppointmentSessionExpired(session)) {
    await releaseLockedSlots(session.session_id);
    session = await expireManageAppointmentSession(session);
    return makeResult({
      payload: buildManageSessionExpiredPayload(normalizedPhone),
      session,
      expired: true,
      event: "manage_session_expired",
    });
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
