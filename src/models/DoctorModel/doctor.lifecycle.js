/**
 * doctor.lifecycle.js
 * CASCADE:
 *   doctors
 *     └─ doctor_availability     hard-delete cascade
 *     └─ doctor_specializations  hard-delete cascade
 *     └─ appointments            soft-delete cascade (retain patient records)
 */
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  annotateDeletedRows, isRestoreEligible,
  RestoreExpiredError, NotFoundError, lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchDoctor = async (doctorId, tenant_id, t = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, doctor_id, name, status, is_deleted, deleted_at
     FROM ${tableNames.DOCTORS}
     WHERE doctor_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
    { replacements: [doctorId, tenant_id], transaction: t },
  );
  return rows[0] || null;
};

export const softDeleteDoctor = async (doctorId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchDoctor(doctorId, tenant_id, t);
    if (!row) throw new NotFoundError("Doctor not found");
    if (row.is_deleted) throw new Error("Doctor is already deleted");
    await db.sequelize.query(
      `UPDATE ${tableNames.DOCTORS}
       SET is_deleted = true, deleted_at = NOW(), status = 'inactive', updated_at = NOW()
       WHERE doctor_id = ? AND tenant_id = ?`,
      { replacements: [doctorId, tenant_id], transaction: t },
    );
    // Soft-delete their future appointments
    await db.sequelize.query(
      `UPDATE ${tableNames.APPOINTMENTS}
       SET is_deleted = true, deleted_at = NOW(), status = 'cancelled', updated_at = NOW()
       WHERE doctor_id = ? AND tenant_id = ? AND is_deleted = false
         AND appointment_date >= CURDATE()`,
      { replacements: [doctorId, tenant_id], transaction: t },
    );
  });
};

export const restoreDoctor = async (doctorId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchDoctor(doctorId, tenant_id, t);
    if (!row) throw new NotFoundError("Doctor not found");
    if (!row.is_deleted) throw new Error("Doctor is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();
    await db.sequelize.query(
      `UPDATE ${tableNames.DOCTORS}
       SET is_deleted = false, deleted_at = NULL, status = 'active', updated_at = NOW()
       WHERE doctor_id = ? AND tenant_id = ?`,
      { replacements: [doctorId, tenant_id], transaction: t },
    );
    return row;
  });
};

export const hardDeleteDoctor = async (doctorId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchDoctor(doctorId, tenant_id, t);
    if (!row) throw new NotFoundError("Doctor not found");
    await db.sequelize.query(
      `DELETE FROM ${tableNames.DOCTOR_SPECIALIZATIONS} WHERE doctor_id = ?`,
      { replacements: [doctorId], transaction: t },
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.DOCTOR_AVAILABILITY} WHERE doctor_id = ? AND tenant_id = ?`,
      { replacements: [doctorId, tenant_id], transaction: t },
    );
    // Nullify doctor_id on appointments rather than deleting (preserve patient records)
    await db.sequelize.query(
      `UPDATE ${tableNames.APPOINTMENTS}
       SET doctor_id = NULL, updated_at = NOW()
       WHERE doctor_id = ? AND tenant_id = ?`,
      { replacements: [doctorId, tenant_id], transaction: t },
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.DOCTORS} WHERE doctor_id = ? AND tenant_id = ?`,
      { replacements: [doctorId, tenant_id], transaction: t },
    );
  });
};

export const getDeletedDoctors = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const [rows] = await db.sequelize.query(
    `SELECT doctor_id, name, title, email, mobile, qualification,
            deleted_at, created_at
     FROM ${tableNames.DOCTORS}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );
  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.DOCTORS}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );
  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

export const softDeleteDoctorController = lifecycleHandler(async (req, res) => {
  await softDeleteDoctor(req.params.doctor_id, req.user.tenant_id);
  return res.status(200).json({ message: "Doctor moved to trash" });
});
export const restoreDoctorController = lifecycleHandler(async (req, res) => {
  const data = await restoreDoctor(req.params.doctor_id, req.user.tenant_id);
  return res.status(200).json({ message: "Doctor restored", data });
});
export const hardDeleteDoctorController = lifecycleHandler(async (req, res) => {
  await hardDeleteDoctor(req.params.doctor_id, req.user.tenant_id);
  return res.status(200).json({ message: "Doctor permanently deleted" });
});
export const getDeletedDoctorsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedDoctors(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
