import { Op } from "sequelize";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";

const optionalStringFields = [
  "code",
  "address",
  "city",
  "state",
  "country",
  "pincode",
  "phone",
  "email",
  "google_map_url",
  "notes",
  "timezone",
  "landmark",
];

const buildError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const normalizeOptionalString = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
};

const normalizeCode = (value) => {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toUpperCase() : null;
};

const normalizePhone = (value) => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  return normalized.replace(/\s+/g, "");
};

const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return Boolean(value);
};

const sanitizeCreatePayload = (data) => {
  const payload = {};
  payload.name = String(data.name || "").trim();
  payload.code = normalizeCode(data.code);
  payload.address = normalizeOptionalString(data.address);
  payload.city = normalizeOptionalString(data.city);
  payload.state = normalizeOptionalString(data.state);
  payload.country = normalizeOptionalString(data.country);
  payload.pincode = normalizeOptionalString(data.pincode);
  payload.phone = normalizePhone(data.phone);
  payload.email = normalizeOptionalString(data.email);
  payload.google_map_url = normalizeOptionalString(data.google_map_url);
  payload.notes = normalizeOptionalString(data.notes);
  payload.timezone = normalizeOptionalString(data.timezone);
  payload.landmark = normalizeOptionalString(data.landmark);
  payload.latitude =
    data.latitude === undefined || data.latitude === null || data.latitude === ""
      ? null
      : Number(data.latitude);
  payload.longitude =
    data.longitude === undefined ||
    data.longitude === null ||
    data.longitude === ""
      ? null
      : Number(data.longitude);
  payload.is_main = parseBoolean(data.is_main, false);
  payload.is_active = parseBoolean(data.is_active, true);
  return payload;
};

const sanitizeUpdatePayload = (data) => {
  const payload = {};

  if (data.name !== undefined) payload.name = String(data.name || "").trim();
  for (const field of optionalStringFields) {
    if (data[field] !== undefined) {
      payload[field] =
        field === "code"
          ? normalizeCode(data[field])
          : field === "phone"
            ? normalizePhone(data[field])
            : normalizeOptionalString(data[field]);
    }
  }

  if (data.latitude !== undefined) {
    payload.latitude =
      data.latitude === null || data.latitude === ""
        ? null
        : Number(data.latitude);
  }
  if (data.longitude !== undefined) {
    payload.longitude =
      data.longitude === null || data.longitude === ""
        ? null
        : Number(data.longitude);
  }
  if (data.is_main !== undefined) payload.is_main = parseBoolean(data.is_main);
  if (data.is_active !== undefined)
    payload.is_active = parseBoolean(data.is_active);

  return payload;
};

const findExistingActiveMainBranch = async (
  tenant_id,
  excludeBranchId = null,
  transaction = null,
) => {
  const where = {
    tenant_id,
    is_deleted: false,
    is_active: true,
    is_main: true,
  };

  if (excludeBranchId) {
    where.branch_id = { [Op.ne]: excludeBranchId };
  }

  return db.Branches.findOne({
    where,
    attributes: ["branch_id", "name"],
    transaction,
  });
};

export const createBranchService = async (tenant_id, data, actor_id = null) => {
  const payload = sanitizeCreatePayload(data);
  const transaction = await db.sequelize.transaction();

  try {
    const duplicateName = await db.Branches.findOne({
      where: {
        tenant_id,
        is_deleted: false,
        name: payload.name,
      },
      transaction,
    });

    if (duplicateName) {
      throw buildError("Branch name already exists", 409);
    }

    if (payload.code) {
      const duplicateCode = await db.Branches.findOne({
        where: {
          tenant_id,
          is_deleted: false,
          code: payload.code,
        },
        transaction,
      });

      if (duplicateCode) {
        throw buildError("Branch code already exists", 409);
      }
    }

    if (payload.is_main) {
      const existingMain = await findExistingActiveMainBranch(
        tenant_id,
        null,
        transaction,
      );
      if (existingMain) {
        throw buildError(
          "A main branch already exists for this tenant",
          409,
        );
      }
    }

    const branch_id = await generateReadableIdFromLast(
      tableNames.BRANCHES,
      "branch_id",
      "BR",
      5,
      transaction,
    );

    const created = await db.Branches.create(
      {
        branch_id,
        tenant_id,
        name: payload.name,
        code: payload.code,
        address: payload.address,
        city: payload.city,
        state: payload.state,
        country: payload.country,
        pincode: payload.pincode,
        phone: payload.phone,
        email: payload.email,
        google_map_url: payload.google_map_url,
        is_main: payload.is_main,
        is_active: payload.is_active,
        is_deleted: false,
        deleted_at: null,
        created_by: actor_id,
        updated_by: actor_id,
        notes: payload.notes,
        timezone: payload.timezone,
        landmark: payload.landmark,
        latitude: payload.latitude,
        longitude: payload.longitude,
      },
      { transaction },
    );

    await transaction.commit();
    return created.get({ plain: true });
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const getBranchListService = async (
  tenant_id,
  { search, is_active } = {},
) => {
  let whereClause = `WHERE tenant_id = ? AND is_deleted = false`;
  const replacements = [tenant_id];

  if (search && String(search).trim()) {
    whereClause += ` AND (name LIKE ? OR code LIKE ? OR city LIKE ? OR phone LIKE ?)`;
    const like = `%${String(search).trim()}%`;
    replacements.push(like, like, like, like);
  }

  if (is_active !== undefined && is_active !== null && is_active !== "") {
    const activeFlag =
      String(is_active).toLowerCase() === "true" || String(is_active) === "1"
        ? 1
        : 0;
    whereClause += ` AND is_active = ?`;
    replacements.push(activeFlag);
  }

  const [rows] = await db.sequelize.query(
    `SELECT *
     FROM ${tableNames.BRANCHES}
     ${whereClause}
     ORDER BY created_at DESC`,
    { replacements },
  );

  return rows;
};

export const getDeletedBranchListService = async (tenant_id) => {
  const [rows] = await db.sequelize.query(
    `SELECT *
     FROM ${tableNames.BRANCHES}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC`,
    { replacements: [tenant_id] },
  );

  return rows;
};

export const getBranchByIdService = async (branch_id, tenant_id) => {
  return db.Branches.findOne({
    where: { branch_id, tenant_id, is_deleted: false },
  });
};

export const updateBranchService = async (
  branch_id,
  tenant_id,
  data,
  actor_id = null,
) => {
  const payload = sanitizeUpdatePayload(data);
  const transaction = await db.sequelize.transaction();

  try {
    const branch = await db.Branches.findOne({
      where: { branch_id, tenant_id },
      transaction,
    });

    if (!branch) {
      throw buildError("Branch not found", 404);
    }

    if (branch.is_deleted) {
      throw buildError("Cannot update a deleted branch. Restore it first.", 409);
    }

    if (payload.name !== undefined) {
      const duplicateName = await db.Branches.findOne({
        where: {
          tenant_id,
          is_deleted: false,
          name: payload.name,
          branch_id: { [Op.ne]: branch_id },
        },
        transaction,
      });
      if (duplicateName) {
        throw buildError("Branch name already exists", 409);
      }
    }

    if (payload.code) {
      const duplicateCode = await db.Branches.findOne({
        where: {
          tenant_id,
          is_deleted: false,
          code: payload.code,
          branch_id: { [Op.ne]: branch_id },
        },
        transaction,
      });
      if (duplicateCode) {
        throw buildError("Branch code already exists", 409);
      }
    }

    if (payload.is_main === true && !branch.is_main) {
      const existingMain = await findExistingActiveMainBranch(
        tenant_id,
        branch_id,
        transaction,
      );
      if (existingMain) {
        throw buildError(
          "A main branch already exists for this tenant",
          409,
        );
      }
    }

    if (Object.keys(payload).length > 0) {
      payload.updated_by = actor_id;
      await db.Branches.update(payload, {
        where: { branch_id, tenant_id, is_deleted: false },
        transaction,
      });
    }

    const updated = await db.Branches.findOne({
      where: { branch_id, tenant_id, is_deleted: false },
      transaction,
    });

    await transaction.commit();
    return updated?.get({ plain: true });
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const softDeleteBranchService = async (branch_id, tenant_id) => {
  const transaction = await db.sequelize.transaction();

  try {
    const branch = await db.Branches.findOne({
      where: { branch_id, tenant_id },
      transaction,
    });

    if (!branch) {
      throw buildError("Branch not found", 404);
    }

    if (branch.is_deleted) {
      throw buildError("Branch is already deleted", 409);
    }

    if (branch.is_main) {
      throw buildError(
        "Main branch cannot be deleted. Please assign another main branch first.",
        409,
      );
    }

    await db.Branches.update(
      {
        is_deleted: true,
        is_active: false,
        deleted_at: new Date(),
      },
      {
        where: { branch_id, tenant_id, is_deleted: false },
        transaction,
      },
    );

    await transaction.commit();
    return { message: "Branch deleted successfully" };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const restoreBranchService = async (branch_id, tenant_id) => {
  const transaction = await db.sequelize.transaction();

  try {
    const branch = await db.Branches.findOne({
      where: { branch_id, tenant_id, is_deleted: true },
      transaction,
    });

    if (!branch) {
      throw buildError("Branch not found or not deleted", 404);
    }

    let restoredMain = Boolean(branch.is_main);
    const existingMain = await findExistingActiveMainBranch(
      tenant_id,
      branch_id,
      transaction,
    );

    if (existingMain) {
      restoredMain = false;
    }

    await db.Branches.update(
      {
        is_deleted: false,
        deleted_at: null,
        is_active: true,
        is_main: restoredMain,
      },
      {
        where: { branch_id, tenant_id, is_deleted: true },
        transaction,
      },
    );

    await transaction.commit();
    return {
      message: "Branch restored successfully",
      is_main: restoredMain,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

export const permanentDeleteBranchService = async (branch_id, tenant_id) => {
  const transaction = await db.sequelize.transaction();

  try {
    const branch = await db.Branches.findOne({
      where: { branch_id, tenant_id },
      transaction,
    });

    if (!branch) {
      throw buildError("Branch not found", 404);
    }

    if (!branch.is_deleted) {
      throw buildError(
        "Please soft delete this branch before permanent deletion.",
        409,
      );
    }

    await db.Branches.destroy({
      where: { branch_id, tenant_id, is_deleted: true },
      transaction,
    });

    await transaction.commit();
    return { message: "Branch permanently deleted successfully" };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};
