/**
 * appointment.lifecycle.js
 * CASCADE: appointments → booking_sessions (hard-delete)
 */
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  annotateDeletedRows, isRestoreEligible,
  RestoreExpiredError, NotFoundError, lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchAppointment = async (appointmentId, tenant_id, t = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, appointment_id, patient_name, appointment_date, status,
            is_deleted, deleted_at
     FROM ${tableNames.APPOINTMENTS}
     WHERE appointment_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
    { replacements: [appointmentId, tenant_id], transaction: t },
  );
  return rows[0] || null;
};

export const softDeleteAppointment = async (appointmentId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchAppointment(appointmentId, tenant_id, t);
    if (!row) throw new NotFoundError("Appointment not found");
    if (row.is_deleted) throw new Error("Appointment is already deleted");
    await db.sequelize.query(
      `UPDATE ${tableNames.APPOINTMENTS}
       SET is_deleted = true, deleted_at = NOW(), status = 'cancelled', updated_at = NOW()
       WHERE appointment_id = ? AND tenant_id = ?`,
      { replacements: [appointmentId, tenant_id], transaction: t },
    );
    // Cancel related booking sessions
    await db.sequelize.query(
      `UPDATE ${tableNames.BOOKING_SESSIONS}
       SET status = 'cancelled', updated_at = NOW()
       WHERE appointment_id = ? AND tenant_id = ?`,
      { replacements: [appointmentId, tenant_id], transaction: t },
    );
  });
};

export const restoreAppointment = async (appointmentId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchAppointment(appointmentId, tenant_id, t);
    if (!row) throw new NotFoundError("Appointment not found");
    if (!row.is_deleted) throw new Error("Appointment is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();
    await db.sequelize.query(
      `UPDATE ${tableNames.APPOINTMENTS}
       SET is_deleted = false, deleted_at = NULL, status = 'scheduled', updated_at = NOW()
       WHERE appointment_id = ? AND tenant_id = ?`,
      { replacements: [appointmentId, tenant_id], transaction: t },
    );
    return row;
  });
};

export const hardDeleteAppointment = async (appointmentId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchAppointment(appointmentId, tenant_id, t);
    if (!row) throw new NotFoundError("Appointment not found");
    await db.sequelize.query(
      `DELETE FROM ${tableNames.BOOKING_SESSIONS}
       WHERE appointment_id = ? AND tenant_id = ?`,
      { replacements: [appointmentId, tenant_id], transaction: t },
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.APPOINTMENTS}
       WHERE appointment_id = ? AND tenant_id = ?`,
      { replacements: [appointmentId, tenant_id], transaction: t },
    );
  });
};

export const getDeletedAppointments = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const [rows] = await db.sequelize.query(
    `SELECT appointment_id, patient_name, appointment_date, appointment_time,
            doctor_id, deleted_at, created_at
     FROM ${tableNames.APPOINTMENTS}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );
  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.APPOINTMENTS}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );
  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

export const softDeleteAppointmentController = lifecycleHandler(async (req, res) => {
  await softDeleteAppointment(req.params.appointment_id, req.user.tenant_id);
  return res.status(200).json({ message: "Appointment moved to trash" });
});
export const restoreAppointmentController = lifecycleHandler(async (req, res) => {
  const data = await restoreAppointment(req.params.appointment_id, req.user.tenant_id);
  return res.status(200).json({ message: "Appointment restored", data });
});
export const hardDeleteAppointmentController = lifecycleHandler(async (req, res) => {
  await hardDeleteAppointment(req.params.appointment_id, req.user.tenant_id);
  return res.status(200).json({ message: "Appointment permanently deleted" });
});
export const getDeletedAppointmentsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedAppointments(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
