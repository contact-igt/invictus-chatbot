/**
 * specialization.lifecycle.js
 * CASCADE: specializations → doctor_specializations (hard-delete)
 */
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  annotateDeletedRows, isRestoreEligible,
  RestoreExpiredError, NotFoundError, lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchSpec = async (specId, tenant_id, t = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, specialization_id, name, is_active, is_deleted, deleted_at
     FROM ${tableNames.SPECIALIZATIONS}
     WHERE specialization_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
    { replacements: [specId, tenant_id], transaction: t },
  );
  return rows[0] || null;
};

export const softDeleteSpecialization = async (specId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchSpec(specId, tenant_id, t);
    if (!row) throw new NotFoundError("Specialization not found");
    if (row.is_deleted) throw new Error("Specialization is already deleted");
    await db.sequelize.query(
      `UPDATE ${tableNames.SPECIALIZATIONS}
       SET is_deleted = true, deleted_at = NOW(), is_active = false, updated_at = NOW()
       WHERE specialization_id = ? AND tenant_id = ?`,
      { replacements: [specId, tenant_id], transaction: t },
    );
  });
};

export const restoreSpecialization = async (specId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchSpec(specId, tenant_id, t);
    if (!row) throw new NotFoundError("Specialization not found");
    if (!row.is_deleted) throw new Error("Specialization is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();
    await db.sequelize.query(
      `UPDATE ${tableNames.SPECIALIZATIONS}
       SET is_deleted = false, deleted_at = NULL, is_active = true, updated_at = NOW()
       WHERE specialization_id = ? AND tenant_id = ?`,
      { replacements: [specId, tenant_id], transaction: t },
    );
    return row;
  });
};

export const hardDeleteSpecialization = async (specId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchSpec(specId, tenant_id, t);
    if (!row) throw new NotFoundError("Specialization not found");
    await db.sequelize.query(
      `DELETE FROM ${tableNames.DOCTOR_SPECIALIZATIONS} WHERE specialization_id = ?`,
      { replacements: [specId], transaction: t },
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.SPECIALIZATIONS}
       WHERE specialization_id = ? AND tenant_id = ?`,
      { replacements: [specId, tenant_id], transaction: t },
    );
  });
};

export const getDeletedSpecializations = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const [rows] = await db.sequelize.query(
    `SELECT specialization_id, name, description, deleted_at, created_at
     FROM ${tableNames.SPECIALIZATIONS}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );
  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.SPECIALIZATIONS}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );
  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

export const softDeleteSpecializationController = lifecycleHandler(async (req, res) => {
  await softDeleteSpecialization(req.params.specialization_id, req.user.tenant_id);
  return res.status(200).json({ message: "Specialization moved to trash" });
});
export const restoreSpecializationController = lifecycleHandler(async (req, res) => {
  const data = await restoreSpecialization(req.params.specialization_id, req.user.tenant_id);
  return res.status(200).json({ message: "Specialization restored", data });
});
export const hardDeleteSpecializationController = lifecycleHandler(async (req, res) => {
  await hardDeleteSpecialization(req.params.specialization_id, req.user.tenant_id);
  return res.status(200).json({ message: "Specialization permanently deleted" });
});
export const getDeletedSpecializationsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedSpecializations(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
