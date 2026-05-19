import db from "../../database/index.js";
import { Op } from "sequelize";

export const SLOT_STATUS = {
  AVAILABLE: "AVAILABLE",
  LOCKED: "LOCKED",
  BOOKED: "BOOKED",
  EXPIRED: "EXPIRED",
};

const normalizeLockUntil = (session) => {
  const fiveMinutes = new Date(Date.now() + 5 * 60 * 1000);
  if (!session?.expires_at) return fiveMinutes;
  const sessionExpiry = new Date(session.expires_at);
  return sessionExpiry < fiveMinutes ? sessionExpiry : fiveMinutes;
};

export const expireOldSlotLocks = async () => {
  await db.AppointmentSlots.update(
    {
      status: SLOT_STATUS.EXPIRED,
      locked_by_session_id: null,
      locked_until: null,
      updatedAt: new Date(),
    },
    {
      where: {
        status: SLOT_STATUS.LOCKED,
        locked_until: { [Op.lt]: new Date() },
      },
    },
  );
};

export const releaseLockedSlots = async (sessionId) => {
  if (!sessionId) return 0;
  const [count] = await db.AppointmentSlots.update(
    {
      status: SLOT_STATUS.EXPIRED,
      locked_by_session_id: null,
      locked_until: null,
      updatedAt: new Date(),
    },
    {
      where: {
        locked_by_session_id: sessionId,
        status: SLOT_STATUS.LOCKED,
      },
    },
  );
  return count;
};

export const isSlotLockedBySessionOrAvailable = async ({
  tenantId,
  doctorId,
  date,
  time,
  sessionId,
}) => {
  await expireOldSlotLocks();
  const slot = await db.AppointmentSlots.findOne({
    where: {
      tenant_id: tenantId,
      doctor_id: doctorId,
      appointment_date: date,
      appointment_time: time,
    },
  });

  if (!slot) return true;
  if (slot.status === SLOT_STATUS.BOOKED) return false;
  if (slot.status === SLOT_STATUS.LOCKED) {
    return slot.locked_by_session_id === sessionId;
  }
  return true;
};

export const lockAppointmentSlot = async ({
  tenantId,
  session,
  doctorId,
  date,
  time,
}) => {
  await expireOldSlotLocks();
  const sessionId = session.session_id;
  const lockedUntil = normalizeLockUntil(session);

  return db.sequelize.transaction(async (transaction) => {
    const existing = await db.AppointmentSlots.findOne({
      where: {
        tenant_id: tenantId,
        doctor_id: doctorId,
        appointment_date: date,
        appointment_time: time,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!existing) {
      return db.AppointmentSlots.create(
        {
          tenant_id: tenantId,
          doctor_id: doctorId,
          appointment_date: date,
          appointment_time: time,
          status: SLOT_STATUS.LOCKED,
          locked_by_session_id: sessionId,
          locked_until: lockedUntil,
        },
        { transaction },
      );
    }

    if (existing.status === SLOT_STATUS.BOOKED) {
      throw new Error("This slot is already booked.");
    }

    if (
      existing.status === SLOT_STATUS.LOCKED &&
      existing.locked_by_session_id !== sessionId &&
      existing.locked_until &&
      new Date(existing.locked_until).getTime() > Date.now()
    ) {
      throw new Error("This slot is temporarily held by another user.");
    }

    await existing.update(
      {
        status: SLOT_STATUS.LOCKED,
        locked_by_session_id: sessionId,
        locked_until: lockedUntil,
      },
      { transaction },
    );
    return existing;
  });
};

export const markSlotBooked = async ({
  tenantId,
  session,
  doctorId,
  date,
  time,
  appointmentId,
}) => {
  const sessionId = session.session_id;
  await expireOldSlotLocks();
  const slot = await db.AppointmentSlots.findOne({
    where: {
      tenant_id: tenantId,
      doctor_id: doctorId,
      appointment_date: date,
      appointment_time: time,
    },
  });

  if (!slot) {
    return db.AppointmentSlots.create({
      tenant_id: tenantId,
      doctor_id: doctorId,
      appointment_date: date,
      appointment_time: time,
      status: SLOT_STATUS.BOOKED,
      appointment_id: appointmentId,
    });
  }

  if (
    slot.status === SLOT_STATUS.LOCKED &&
    slot.locked_by_session_id !== sessionId
  ) {
    throw new Error("This slot is locked by another session.");
  }

  if (slot.status === SLOT_STATUS.BOOKED && slot.appointment_id !== appointmentId) {
    throw new Error("This slot is already booked.");
  }

  await slot.update({
    status: SLOT_STATUS.BOOKED,
    locked_by_session_id: null,
    locked_until: null,
    appointment_id: appointmentId,
  });

  return slot;
};
