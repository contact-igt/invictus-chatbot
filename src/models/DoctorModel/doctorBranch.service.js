import db from "../../database/index.js";

export const getDoctorBranchesService = async (tenant_id, doctor_id) => {
  try {
    const rows = await db.DoctorBranches.findAll({
      where: { tenant_id, doctor_id, is_active: true },
      include: [
        {
          model: db.Branches,
          as: "branch",
          where: { is_deleted: false },
          required: false,
          attributes: ["branch_id", "name", "code", "is_active"],
        },
      ],
      order: [
        ["is_primary", "DESC"],
        ["id", "ASC"],
      ],
    });

    return (rows || []).map((r) => ({
      branch_id: r.branch_id,
      is_primary: Boolean(r.is_primary),
      is_active: Boolean(r.is_active),
      branch: r.branch
        ? {
            branch_id: r.branch.branch_id,
            name: r.branch.name,
            code: r.branch.code,
            is_active: r.branch.is_active,
          }
        : null,
    }));
  } catch (err) {
    throw err;
  }
};

export const getBranchDoctorsService = async (tenant_id, branch_id) => {
  try {
    const rows = await db.DoctorBranches.findAll({
      where: { tenant_id, branch_id, is_active: true },
      include: [
        {
          model: db.Doctors,
          as: "doctor",
          where: { is_deleted: false },
          required: false,
          attributes: ["doctor_id", "name", "title", "status"],
        },
      ],
      order: [
        ["is_primary", "DESC"],
        ["id", "ASC"],
      ],
    });

    return (rows || []).map((r) => ({
      doctor_id: r.doctor_id,
      is_primary: Boolean(r.is_primary),
      is_active: Boolean(r.is_active),
      doctor: r.doctor
        ? {
            doctor_id: r.doctor.doctor_id,
            name: r.doctor.name,
            title: r.doctor.title,
            status: r.doctor.status,
          }
        : null,
    }));
  } catch (err) {
    throw err;
  }
};

export const replaceDoctorBranchesService = async (
  tenant_id,
  doctor_id,
  branches = [],
) => {
  const transaction = await db.sequelize.transaction();
  try {
    // Validate doctor exists and not deleted
    const doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id, is_deleted: false },
    });
    if (!doctor) throw new Error("Doctor not found");

    if (!Array.isArray(branches)) {
      throw new Error("branches must be an array");
    }

    const branchIds = branches
      .map((b) => String(b.branch_id).trim())
      .filter(Boolean);

    // Duplicate branch_id check
    const uniqueSet = new Set(branchIds);
    if (uniqueSet.size !== branchIds.length) {
      throw new Error("Duplicate branch_id in payload");
    }

    // primary checks
    const primaryCount = branches.filter((b) => b.is_primary === true).length;
    if (primaryCount > 1) {
      throw new Error("At most one primary branch is allowed");
    }

    // If branches provided, validate existence and tenant
    if (branchIds.length > 0) {
      const found = await db.Branches.findAll({
        where: {
          branch_id: branchIds,
          tenant_id,
          is_deleted: false,
          is_active: true,
        },
      });
      if ((found || []).length !== branchIds.length) {
        throw new Error(
          "One or more branches not found or inactive for this tenant",
        );
      }
    }

    // Delete existing mappings for this doctor
    await db.DoctorBranches.destroy({
      where: { doctor_id, tenant_id },
      transaction,
    });

    // Insert new mappings (if any)
    const inserts = [];

    if (branchIds.length === 1 && primaryCount === 0) {
      // Safe choice: if single branch and no primary set, mark it primary
      inserts.push({
        doctor_id,
        branch_id: branchIds[0],
        tenant_id,
        is_primary: true,
        is_active: true,
      });
    } else {
      for (const b of branches) {
        inserts.push({
          doctor_id,
          branch_id: b.branch_id,
          tenant_id,
          is_primary: Boolean(b.is_primary),
          is_active: true,
        });
      }
    }

    if (inserts.length > 0) {
      await db.DoctorBranches.bulkCreate(inserts, { transaction });
    }

    await transaction.commit();

    return getDoctorBranchesService(tenant_id, doctor_id);
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const addDoctorToBranchService = async (
  tenant_id,
  doctor_id,
  branch_id,
  is_primary = false,
) => {
  const transaction = await db.sequelize.transaction();
  try {
    const doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id, is_deleted: false },
    });
    if (!doctor) throw new Error("Doctor not found");

    const branch = await db.Branches.findOne({
      where: { branch_id, tenant_id, is_deleted: false, is_active: true },
    });
    if (!branch) throw new Error("Branch not found or inactive");

    if (is_primary) {
      // unset existing primary for this doctor
      await db.DoctorBranches.update(
        { is_primary: false },
        { where: { doctor_id, tenant_id, is_primary: true }, transaction },
      );
    }

    const existing = await db.DoctorBranches.findOne({
      where: { doctor_id, branch_id, tenant_id },
      transaction,
    });
    if (existing) {
      const updates = {};
      if (is_primary && !existing.is_primary) updates.is_primary = true;
      if (existing.is_active === false) updates.is_active = true;
      if (Object.keys(updates).length > 0) {
        await db.DoctorBranches.update(updates, {
          where: { doctor_id, branch_id, tenant_id },
          transaction,
        });
      }
      await transaction.commit();
      return { created: false, updated: !!Object.keys(updates).length };
    }

    await db.DoctorBranches.create(
      {
        doctor_id,
        branch_id,
        tenant_id,
        is_primary: Boolean(is_primary),
        is_active: true,
      },
      { transaction },
    );
    await transaction.commit();
    return { created: true };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const removeDoctorFromBranchService = async (
  tenant_id,
  doctor_id,
  branch_id,
) => {
  try {
    const deleted = await db.DoctorBranches.destroy({
      where: { tenant_id, doctor_id, branch_id },
    });
    if (deleted === 0) throw new Error("Mapping not found");
    return { message: "Mapping removed" };
  } catch (err) {
    throw err;
  }
};
