import { missingFieldsChecker } from "../../utils/missingFields.js";
import {
  createContactService,
  deleteContactService,
  getAllContactsService,
  getContactByIdAndTenantIdService,
  getContactByPhoneAndTenantIdService,
  updateContactService,
} from "./contacts.service.js";

export const createContactController = async (req, res) => {
  const tenant_id = req.user.tenant_id; // Get from authenticated user
  const { phone, name, profile_pic } = req.body;

  const requiredFields = {
    phone,
  };

  const missing = await missingFieldsChecker(requiredFields);
  if (missing.length > 0) {
    return res.status(400).json({
      message: `Missing fields: ${missing.join(", ")}`,
    });
  }

  try {
    const existingContact = await getContactByPhoneAndTenantIdService(
      tenant_id,
      phone,
    );

    if (existingContact) {
      return res.status(409).send({
        message: "This contact already exists",
      });
    }

    await createContactService(
      tenant_id,
      phone,
      name || null,
      profile_pic || null,
    );

    return res.status(200).send({
      message: "Contact created successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getAllContactsController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({
      message: "Tenant id missing",
    });
  }

  try {
    const response = await getAllContactsService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const getContactByIdController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  if (!tenant_id) {
    return res.status(400).send({ message: "Tenant id missing" });
  }

  try {
    const response = await getContactByIdAndTenantIdService(id, tenant_id);
    if (!response) {
      return res.status(404).send({ message: "Contact not found" });
    }
    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const updateContactController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;
  const { name, email, profile_pic, is_blocked, phone } = req.body;

  if (!tenant_id) {
    return res.status(400).send({ message: "Tenant id missing" });
  }

  // Security: Prevent phone number editing
  if (phone !== undefined) {
    return res.status(403).send({
      message: "Phone number cannot be edited. Please delete and recreate the contact if needed."
    });
  }

  try {
    await updateContactService(
      id,
      tenant_id,
      name,
      email,
      profile_pic,
      is_blocked
    );
    return res.status(200).send({
      message: "Contact updated successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const deleteContactController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { id } = req.params;

  if (!tenant_id) {
    return res.status(400).send({ message: "Tenant id missing" });
  }

  try {
    await deleteContactService(id, tenant_id);
    return res.status(200).send({
      message: "Contact deleted successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
