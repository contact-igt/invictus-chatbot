import { missingFieldsChecker } from "../../utils/missingFields.js";
import { registerManagementService } from "../Management/management.service.js";
import {
  createTenantService,
  deleteTenantService,
  findTenantByIdService,
  getAllTenantService,
  updateTenantService,
  updateTenantStatusService,
} from "./tenant.service.js";

export const createTenantController = async (req, res) => {
  try {
    const { name, email, country_code, mobile, type, password } = req.body;

    const requiredFields = {
      name,
      email,
      country_code,
      mobile,
      type,
      password,
    };

    const missingFields = await missingFieldsChecker(requiredFields);
    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    const tenant = await createTenantService(
      name,
      email,
      country_code,
      mobile,
      type,
    );

    if (tenant) {
      await registerManagementService(
        null,
        name,
        email,
        country_code,
        mobile,
        password,
        "admin",
        tenant,
      );
    }

    return res.status(200).json({
      message: "Tenant onboarded successfully",
      tenant_id: tenant.id,
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message: "Email or mobile already exists",
      });
    }

    return res.status(500).json({
      message: err.message,
    });
  }
};

export const getAllTenantController = async (req, res) => {
  try {
    const response = await getAllTenantService();
    return res.status(200).send({
      data: response,
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
};

export const getTenantByIdController = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await findTenantByIdService(id);

    if (!id) {
      return res.status(400).json({ message: "Tenant details not found" });
    }

    return res.status(200).send({
      data: response,
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
};

export const updateTenantController = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, country_code, mobile, type } = req.body;

    const requiredFields = {
      name,
      email,
      country_code,
      mobile,
      type,
    };

    const missingFields = await missingFieldsChecker(requiredFields);

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Missing required field(s) ${missingFields.join(", ")} `,
      });
    }

    await updateTenantService(name, email, country_code, mobile, type, id);

    return res.status(200).send({
      message: "Tentnat updated successfully",
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Try another email or mobile" });
    }

    return res.status(500).json({
      message: err.message,
    });
  }
};

export const updateTenantStatusController = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.query;

    if (!status) {
      return res.status(400).send({
        message: "Status is required",
      });
    }

    if (!["active", "inactive"].includes(status)) {
      return res.status(400).send({
        message: "Invalid status",
      });
    }

    await updateTenantStatusService(status, id);

    return res.status(200).send({
      message: "Tentnat status updated successfully",
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
};

export const deleteTenantController = async (req, res) => {
  try {
    const { id } = req.params;
    await deleteTenantService(id);
    return res.status(200).send({
      message: "Tentnat removed successfully",
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
};
