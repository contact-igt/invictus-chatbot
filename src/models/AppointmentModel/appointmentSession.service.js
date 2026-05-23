import db from "../../database/index.js";
import { Op } from "sequelize";

export const ADVANCED_SESSION_STATUS = {
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
};

export const SESSION_TTL_MS = 5 * 60 * 1000;

export const addSessionTtl = (base = new Date()) =>
  new Date(base.getTime() + SESSION_TTL_MS);

export const isSessionExpired = (session) => {
  if (!session?.expires_at) return false;
  return new Date(session.expires_at).getTime() <= Date.now();
};

const normalizeDraft = (session) => {
  const raw = session?.draft_json;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

export const getSessionDraft = normalizeDraft;

const clearSlotSelection = (session) => {
  const draft = { ...normalizeDraft(session) };
  delete draft.slotSelection;
  return draft;
};

const generateSessionId = async (tenantId) => {
  const [rows] = await db.sequelize.query(
    `SELECT session_id FROM booking_sessions
     WHERE tenant_id = ? AND session_id LIKE 'AS%'
     ORDER BY session_id DESC LIMIT 1`,
    { replacements: [tenantId] },
  );
  const last = rows?.[0]?.session_id ? String(rows[0].session_id) : null;
  const lastNum = last ? parseInt(last.replace(/^AS/i, ""), 10) : 0;
  const next = Number.isFinite(lastNum) ? lastNum + 1 : 1;
  return `AS${String(next).padStart(4, "0")}`;
};

export const getActiveAppointmentSession = async ({ tenantId, contactId, userPhone }) => {
  const identityFilters = [];
  if (contactId) identityFilters.push({ contact_id: contactId });
  if (userPhone) identityFilters.push({ user_phone: userPhone });
  if (!identityFilters.length) return null;

  const where = {
    tenant_id: tenantId,
    flow_type: "book",
    status: { [Op.in]: [ADVANCED_SESSION_STATUS.IN_PROGRESS] },
    current_step: { [Op.ne]: "BOOKING_COMPLETE" },
  };

  if (identityFilters.length === 1) {
    Object.assign(where, identityFilters[0]);
  } else {
    where[Op.or] = identityFilters;
  }

  return db.BookingSessions.findOne({
    where,
    order: [["updatedAt", "DESC"]],
  });
};

export const getOrCreateAppointmentSession = async ({
  tenantId,
  contactId,
  userPhone,
  initialState,
  draft = {},
}) => {
  const active = await getActiveAppointmentSession({ tenantId, contactId, userPhone });
  if (active) return { session: active, created: false };

  const now = new Date();
  const session = await db.BookingSessions.create({
    session_id: await generateSessionId(tenantId),
    tenant_id: tenantId,
    contact_id: contactId,
    user_phone: userPhone,
    flow_type: "book",
    current_step: initialState,
    last_valid_state: initialState,
    draft_json: draft,
    status: ADVANCED_SESSION_STATUS.IN_PROGRESS,
    expires_at: addSessionTtl(now),
  });

  return { session, created: true };
};

export const refreshAppointmentSessionTimeout = async (session) => {
  await session.update({
    expires_at: addSessionTtl(),
    updatedAt: new Date(),
  });
  return session.reload();
};

export const updateAppointmentDraft = async (session, draftPatch = {}) => {
  const draft = { ...normalizeDraft(session) };
  for (const [key, value] of Object.entries(draftPatch)) {
    if (value === undefined) {
      delete draft[key];
    } else {
      draft[key] = value;
    }
  }
  await session.update({
    draft_json: draft,
    expires_at: addSessionTtl(),
    updatedAt: new Date(),
  });
  await session.reload();
  return draft;
};

export const transitionAppointmentState = async ({
  session,
  toState,
  draft = null,
  editTarget = undefined,
  lastValidState = undefined,
  refreshTimeout = true,
}) => {
  const update = {
    current_step: toState,
    updatedAt: new Date(),
  };
  if (draft !== null) update.draft_json = draft;
  if (editTarget !== undefined) update.edit_target = editTarget;
  if (lastValidState !== undefined) update.last_valid_state = lastValidState;
  if (refreshTimeout) update.expires_at = addSessionTtl();
  await session.update(update);
  return session.reload();
};

export const expireAppointmentSession = async (session) => {
  await session.update({
    status: ADVANCED_SESSION_STATUS.EXPIRED,
    current_step: null,
    draft_json: clearSlotSelection(session),
    updatedAt: new Date(),
  });
  return session.reload();
};

export const cancelAppointmentSession = async (session) => {
  await session.update({
    status: ADVANCED_SESSION_STATUS.CANCELLED,
    current_step: null,
    draft_json: clearSlotSelection(session),
    updatedAt: new Date(),
  });
  return session.reload();
};

export const completeAppointmentSession = async (session) => {
  await session.update({
    status: ADVANCED_SESSION_STATUS.COMPLETED,
    current_step: null,
    draft_json: clearSlotSelection(session),
    updatedAt: new Date(),
  });
  return session.reload();
};

export const expireOldAppointmentSessions = async () => {
  const expired = await db.BookingSessions.findAll({
    where: {
      flow_type: "book",
      status: ADVANCED_SESSION_STATUS.IN_PROGRESS,
      expires_at: { [Op.lt]: new Date() },
    },
  });

  for (const session of expired) {
    await expireAppointmentSession(session);
  }

  return expired;
};
