import { missingFieldsChecker } from "../../utils/missingFields.js";
import {
  createContactService,
  getAllContactsService,
  getContactByPhoneAndTenantIdService,
} from "./contacts.service.js";

export const createContactController = async (req, res) => {
  const { tenant_id, phone, name, profile_pic } = req.body;

  const requiredFields = {
    tenant_id,
    phone,
  };

  const missing = await missingFieldsChecker(requiredFields);
  if (missing.length > 0) {
    return res.status(400).json({
      message: `Missing fields: ${missing.join(", ")}`,
    });
  }

  try {
    const checkDoubeUser = await getContactByPhoneAndTenantIdService(
      tenant_id,
      phone,
    );

    if (checkDoubeUser?.length > 0) {
      return res.status(404).send({
        message: "This contact already created",
      });
    }

    await createContactService(
      tenant_id,
      phone,
      name ? name : null,
      profile_pic ? profile_pic : null,
    );

    return res.status(200).send({
      message: "success",
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
