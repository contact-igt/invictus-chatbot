import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { cascadeDeleteSpecialization } from "../../database/cascadeDelete.js";

// ─── Create ───
export const createSpecializationService = async (
  tenant_id,
  name,
  description = null,
) => {
  try {
    const specialization_id = await generateReadableIdFromLast(
      tableNames.SPECIALIZATIONS,
      "specialization_id",
      "SPEC",
      5,
    );

    await db.Specializations.create({
      specialization_id,
      tenant_id,
      name: name.trim(),
      description,
      is_active: true,
      is_deleted: false,
    });

    return {
      specialization_id,
      name: name.trim(),
      description,
      is_active: true,
    };
  } catch (error) {
    throw error;
  }
};

// ─── Find or Create (Auto-create on the fly) ───
export const findOrCreateSpecializationService = async (tenant_id, name) => {
  try {
    const trimmedName = name.trim();

    // Check if it already exists for this tenant
    const existing = await db.Specializations.findOne({
      where: { tenant_id, name: trimmedName, is_deleted: false },
    });

    if (existing) {
      return existing;
    }

    // Auto-create
    const result = await createSpecializationService(tenant_id, trimmedName);

    return await db.Specializations.findOne({
      where: { specialization_id: result.specialization_id },
    });
  } catch (error) {
    throw error;
  }
};

// ─── List All (for a tenant) ───
export const getAllSpecializationsService = async (tenant_id, search) => {
  try {
    let whereClause = `WHERE tenant_id = ? AND is_deleted = false`;
    const replacements = [tenant_id];

    if (search && search.trim()) {
      whereClause += ` AND name LIKE ?`;
      replacements.push(`%${search.trim()}%`);
    }

    const [rows] = await db.sequelize.query(
      `SELECT specialization_id, name, description, is_active, created_at
     FROM ${tableNames.SPECIALIZATIONS}
     ${whereClause}
     ORDER BY specialization_id DESC`,
      { replacements },
    );

    // Convert is_active from 1/0 to true/false
    return rows.map((row) => ({
      ...row,
      is_active: Boolean(row.is_active),
    }));
  } catch (error) {
    throw error;
  }
};

// ─── Get By ID ───
export const getSpecializationByIdService = async (
  specialization_id,
  tenant_id,
) => {
  try {
    return await db.Specializations.findOne({
      where: { specialization_id, tenant_id, is_deleted: false },
    });
  } catch (error) {
    throw error;
  }
};

// ─── Update ───
export const updateSpecializationService = async (
  specialization_id,
  tenant_id,
  data,
) => {
  try {
    const updateFields = {};
    if (data.name) updateFields.name = data.name.trim();
    if (data.description !== undefined)
      updateFields.description = data.description;
    if (data.is_active !== undefined) updateFields.is_active = data.is_active;

    const [updated] = await db.Specializations.update(updateFields, {
      where: { specialization_id, tenant_id, is_deleted: false },
    });

    if (updated === 0) {
      throw new Error("Specialization not found");
    }

    return { message: "Specialization updated successfully" };
  } catch (error) {
    throw error;
  }
};

// ─── Toggle Active Status ───
export const toggleActiveStatusService = async (
  specialization_id,
  tenant_id,
) => {
  try {
    // Get current status
    const spec = await db.Specializations.findOne({
      where: { specialization_id, tenant_id, is_deleted: false },
    });

    if (!spec) {
      throw new Error("Specialization not found");
    }

    // Toggle the status (flip it)
    const newStatus = !spec.is_active;

    await db.Specializations.update(
      { is_active: newStatus },
      { where: { specialization_id, tenant_id, is_deleted: false } },
    );

    return {
      message: "Specialization status updated successfully",
      is_active: newStatus,
    };
  } catch (error) {
    throw error;
  }
};

// ─── Soft Delete ───
export const deleteSpecializationService = async (
  specialization_id,
  tenant_id,
) => {
  try {
    // Check if specialization exists
    const spec = await db.Specializations.findOne({
      where: { specialization_id, tenant_id, is_deleted: false },
    });

    if (!spec) {
      throw new Error("Specialization not found");
    }

    // Check if any active doctors use this specialization
    const [usageRows] = await db.sequelize.query(
      `SELECT COUNT(*) as count FROM ${tableNames.DOCTOR_SPECIALIZATIONS} ds
      JOIN ${tableNames.DOCTORS} d ON d.doctor_id = ds.doctor_id AND d.is_deleted = false
      WHERE ds.specialization_id = ?`,
      { replacements: [specialization_id] },
    );

    if (usageRows[0].count > 0) {
      throw new Error(
        `Cannot delete: ${usageRows[0].count} doctor(s) are using this specialization. Remove it from all doctors first.`,
      );
    }

    // Perform Soft Delete
    await db.Specializations.update(
      { is_deleted: true },
      { where: { specialization_id, tenant_id } },
    );

    return { message: "Specialization deleted successfully" };
  } catch (error) {
    throw error;
  }
};

// ─── Get Deleted List ───
export const getDeletedSpecializationListService = async (tenant_id) => {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT specialization_id, name, description, is_active, created_at, updated_at
     FROM ${tableNames.SPECIALIZATIONS}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY updated_at DESC`,
      { replacements: [tenant_id] },
    );

    return rows.map((row) => ({
      ...row,
      is_active: Boolean(row.is_active),
    }));
  } catch (error) {
    throw error;
  }
};

// ─── Restore (Undo Soft Delete) ───
export const restoreSpecializationService = async (
  specialization_id,
  tenant_id,
) => {
  try {
    const spec = await db.Specializations.findOne({
      where: { specialization_id, tenant_id, is_deleted: true },
    });

    if (!spec) {
      throw new Error("Specialization not found or not deleted");
    }

    await db.Specializations.update(
      { is_deleted: false },
      { where: { specialization_id, tenant_id } },
    );

    return { message: "Specialization restored successfully" };
  } catch (error) {
    throw error;
  }
};

// ─── Permanent Delete ───
export const permanentDeleteSpecializationService = async (
  specialization_id,
  tenant_id,
) => {
  try {
    return await cascadeDeleteSpecialization(specialization_id, tenant_id);
  } catch (error) {
    throw error;
  }
};
