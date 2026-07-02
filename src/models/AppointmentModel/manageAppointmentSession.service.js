import db from "../../database/index.js";
import { Op } from "sequelize";
import { releaseLockedSlots } from "./appointmentSlotLock.service.js";

export const MANAGE_APPOINTMENT_SESSION_TTL_MS = 5 * 60 * 1000;

export const MANAGE_APPOINTMENT_SESSION_STATUS = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

export const MANAGE_APPOINTMENT_STATES = {
  SELECT_APPOINTMENT: "SELECT_APPOINTMENT",
  DETAILS: "DETAILS",
  EDIT_MENU: "EDIT_MENU",
  AWAITING_EDIT_VALUE: "AWAITING_EDIT_VALUE",
  WAITING_FOR_NAME_UPDATE: "WAITING_FOR_NAME_UPDATE",
  WAITING_FOR_EMAIL_UPDATE: "WAITING_FOR_EMAIL_UPDATE",
  WAITING_FOR_PHONE_UPDATE: "WAITING_FOR_PHONE_UPDATE",
  WAITING_FOR_REASON_UPDATE: "WAITING_FOR_REASON_UPDATE",
  WAITING_FOR_DOCTOR_UPDATE: "WAITING_FOR_DOCTOR_UPDATE",
  WAITING_FOR_SERVICE_UPDATE: "WAITING_FOR_SERVICE_UPDATE",
  WAITING_FOR_DATE_UPDATE: "WAITING_FOR_DATE_UPDATE",
  WAITING_FOR_SLOT_UPDATE: "WAITING_FOR_SLOT_UPDATE",
  SELECT_DATE: "SELECT_DATE",
  SELECT_TIME: "SELECT_TIME",
  CONFIRM_RESCHEDULE: "CONFIRM_RESCHEDULE",
  CONFIRM_CANCEL: "CONFIRM_CANCEL",
};

export const MANAGE_EDIT_INPUT_STATES = new Set([
  MANAGE_APPOINTMENT_STATES.AWAITING_EDIT_VALUE,
  MANAGE_APPOINTMENT_STATES.WAITING_FOR_NAME_UPDATE,
  MANAGE_APPOINTMENT_STATES.WAITING_FOR_EMAIL_UPDATE,
  MANAGE_APPOINTMENT_STATES.WAITING_FOR_PHONE_UPDATE,
  MANAGE_APPOINTMENT_STATES.WAITING_FOR_REASON_UPDATE,
  MANAGE_APPOINTMENT_STATES.WAITING_FOR_DOCTOR_UPDATE,
  MANAGE_APPOINTMENT_STATES.WAITING_FOR_SERVICE_UPDATE,
  MANAGE_APPOINTMENT_STATES.WAITING_FOR_DATE_UPDATE,
  MANAGE_APPOINTMENT_STATES.WAITING_FOR_SLOT_UPDATE,
]);

export const isManageEditInputState = (state) =>
  MANAGE_EDIT_INPUT_STATES.has(state);

export const addManageAppointmentTtl = (base = new Date()) =>
  new Date(base.getTime() + MANAGE_APPOINTMENT_SESSION_TTL_MS);

export const isManageAppointmentSessionExpired = (session) => {
  if (!session?.expires_at) return false;
  return new Date(session.expires_at).getTime() <= Date.now();
};

const parseJson = (value, fallback) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const getSessionAppointmentIds = (session) =>
  Array.isArray(parseJson(session?.appointment_ids, []))
    ? parseJson(session?.appointment_ids, [])
    : [];

export const getSessionPendingValue = (session) =>
  parseJson(session?.pending_edit_value, null);

const generateSessionId = async () => {
  const [rows] = await db.sequelize.query(
    `SELECT session_id FROM manage_appointment_sessions
     WHERE session_id LIKE 'MS%'
     ORDER BY session_id DESC LIMIT 1`,
  );
  const last = rows?.[0]?.session_id ? String(rows[0].session_id) : null;
  const lastNum = last ? parseInt(last.replace(/^MS/i, ""), 10) : 0;
  const next = Number.isFinite(lastNum) ? lastNum + 1 : 1;
  return `MS${String(next).padStart(4, "0")}`;
};

export const getActiveManageAppointmentSession = async ({ tenantId, userPhone }) => {
  if (!tenantId || !userPhone || !db.ManageAppointmentSessions) return null;
  return db.ManageAppointmentSessions.findOne({
    where: {
      tenant_id: tenantId,
      user_phone: userPhone,
      status: MANAGE_APPOINTMENT_SESSION_STATUS.ACTIVE,
    },
    order: [["updatedAt", "DESC"]],
  });
};

export const createManageAppointmentSession = async ({
  tenantId,
  userPhone,
  contactId = null,
  state = MANAGE_APPOINTMENT_STATES.SELECT_APPOINTMENT,
  appointmentIds = [],
  appointmentCount = 0,
  selectedAppointmentId = null,
  currentPage = 0,
}) => {
  const now = new Date();
  return db.ManageAppointmentSessions.create({
    session_id: await generateSessionId(),
    tenant_id: tenantId,
    user_phone: userPhone,
    contact_id: contactId,
    state,
    appointment_count: appointmentCount,
    appointment_ids: appointmentIds,
    selected_appointment_id: selectedAppointmentId,
    current_page: currentPage,
    status: MANAGE_APPOINTMENT_SESSION_STATUS.ACTIVE,
    last_active_at: now,
    expires_at: addManageAppointmentTtl(now),
  });
};

export const replaceManageAppointmentSession = async ({
  tenantId,
  userPhone,
  contactId = null,
  state,
  appointmentIds = [],
  appointmentCount = 0,
  selectedAppointmentId = null,
  currentPage = 0,
}) => {
  const active = await getActiveManageAppointmentSession({ tenantId, userPhone });
  if (active) {
    await active.update({
      status: MANAGE_APPOINTMENT_SESSION_STATUS.CANCELLED,
      updatedAt: new Date(),
    });
  }
  return createManageAppointmentSession({
    tenantId,
    userPhone,
    contactId,
    state,
    appointmentIds,
    appointmentCount,
    selectedAppointmentId,
    currentPage,
  });
};

export const refreshManageAppointmentSession = async (session) => {
  await session.update({
    last_active_at: new Date(),
    expires_at: addManageAppointmentTtl(),
    updatedAt: new Date(),
  });
  return session.reload();
};

export const updateManageAppointmentSession = async (session, patch = {}) => {
  const update = {
    last_active_at: new Date(),
    expires_at: addManageAppointmentTtl(),
    updatedAt: new Date(),
  };

  for (const [key, value] of Object.entries(patch)) {
    update[key] = value;
  }

  await session.update(update);
  return session.reload();
};

export const clearManageAppointmentSession = async (
  session,
  status = MANAGE_APPOINTMENT_SESSION_STATUS.COMPLETED,
) => {
  if (!session) return null;
  await session.update({
    status,
    state: MANAGE_APPOINTMENT_STATES.DETAILS,
    pending_edit_field: null,
    pending_edit_value: null,
    selected_date: null,
    selected_slot_id: null,
    selected_time: null,
    selected_doctor_id: null,
    updatedAt: new Date(),
  });
  return session.reload();
};

export const expireManageAppointmentSession = async (session) =>
  clearManageAppointmentSession(session, MANAGE_APPOINTMENT_SESSION_STATUS.EXPIRED);

export const expireOldManageAppointmentSessions = async () => {
  if (!db.ManageAppointmentSessions) return 0;
  const sessions = await db.ManageAppointmentSessions.findAll({
    where: {
      status: MANAGE_APPOINTMENT_SESSION_STATUS.ACTIVE,
      expires_at: { [Op.lt]: new Date() },
    },
  });
  for (const session of sessions) {
    await releaseLockedSlots(session.session_id);
    await expireManageAppointmentSession(session);
  }
  return sessions.length;
};
