import {
  createBranchService,
  getBranchListService,
  getBranchByIdService,
  updateBranchService,
} from "./branch.service.js";

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isValidUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

const validateBooleanField = (fieldName, value) => {
  if (value === undefined) return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "false") return null;
  }
  return `${fieldName} must be a boolean value`;
};

const validateBranchPayload = (payload, { isCreate = false } = {}) => {
  const errors = [];

  if (isCreate || payload.name !== undefined) {
    const name = String(payload.name || "").trim();
    if (!name) {
      errors.push("name is required");
    } else if (name.length < 2 || name.length > 150) {
      errors.push("name must be between 2 and 150 characters");
    }
  }

  if (payload.code !== undefined && payload.code !== null) {
    const code = String(payload.code).trim();
    if (code.length > 50) {
      errors.push("code must be at most 50 characters");
    }
  }

  if (payload.email !== undefined && payload.email !== null && payload.email !== "") {
    const email = String(payload.email).trim();
    if (!isValidEmail(email)) {
      errors.push("email must be a valid email address");
    }
  }

  if (
    payload.google_map_url !== undefined &&
    payload.google_map_url !== null &&
    payload.google_map_url !== ""
  ) {
    const googleMapUrl = String(payload.google_map_url).trim();
    if (!isValidUrl(googleMapUrl)) {
      errors.push("google_map_url must be a valid URL");
    }
  }

  if (payload.latitude !== undefined && payload.latitude !== null && payload.latitude !== "") {
    const latitude = Number(payload.latitude);
    if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
      errors.push("latitude must be between -90 and 90");
    }
  }

  if (
    payload.longitude !== undefined &&
    payload.longitude !== null &&
    payload.longitude !== ""
  ) {
    const longitude = Number(payload.longitude);
    if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
      errors.push("longitude must be between -180 and 180");
    }
  }

  if (payload.phone !== undefined && payload.phone !== null && payload.phone !== "") {
    const phone = String(payload.phone).trim().replace(/\s+/g, "");
    if (!/^\+?[0-9]{7,15}$/.test(phone)) {
      errors.push("phone must be a valid phone number");
    }
  }

  const isMainError = validateBooleanField("is_main", payload.is_main);
  if (isMainError) errors.push(isMainError);

  const isActiveError = validateBooleanField("is_active", payload.is_active);
  if (isActiveError) errors.push(isActiveError);

  return errors;
};

const respondFromError = (res, err) => {
  const status = err?.statusCode || 500;
  return res.status(status).send({ message: err?.message || "Internal server error" });
};

export const createBranchController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const actor_id = req.user?.tenant_user_id || null;
  const validationErrors = validateBranchPayload(req.body, { isCreate: true });

  if (validationErrors.length) {
    return res.status(400).send({ message: validationErrors.join(", ") });
  }

  try {
    const createdBranch = await createBranchService(tenant_id, req.body, actor_id);
    return res.status(201).send({
      message: "Branch created successfully",
      data: createdBranch,
    });
  } catch (err) {
    return respondFromError(res, err);
  }
};

export const getBranchListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { search, is_active } = req.query;

  try {
    const rows = await getBranchListService(tenant_id, { search, is_active });
    return res.status(200).send({
      message: "success",
      data: rows,
    });
  } catch (err) {
    return respondFromError(res, err);
  }
};

export const getBranchByIdController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { branch_id } = req.params;

  try {
    const branch = await getBranchByIdService(branch_id, tenant_id);
    if (!branch) {
      return res.status(404).send({ message: "Branch not found" });
    }

    return res.status(200).send({
      message: "success",
      data: branch,
    });
  } catch (err) {
    return respondFromError(res, err);
  }
};

export const updateBranchController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const actor_id = req.user?.tenant_user_id || null;
  const { branch_id } = req.params;
  const validationErrors = validateBranchPayload(req.body, { isCreate: false });

  if (validationErrors.length) {
    return res.status(400).send({ message: validationErrors.join(", ") });
  }

  try {
    const updatedBranch = await updateBranchService(
      branch_id,
      tenant_id,
      req.body,
      actor_id,
    );
    return res.status(200).send({
      message: "Branch updated successfully",
      data: updatedBranch,
    });
  } catch (err) {
    return respondFromError(res, err);
  }
};
