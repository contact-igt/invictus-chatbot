import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";
import { missingFieldsChecker } from "../../utils/missingFields.js";
import { formatPhoneNumber } from "../../utils/formatPhoneNumber.js";
import crypto from "crypto";
import {
  createTenantService,
  deleteTenantService,
  deleteTenantStatusService,
  findTenantByIdService,
  getAllTenantService,
  updateTenantService,
} from "./tenant.service.js";
;
import {
  sendTenantInvitationService,
} from "../TenantInvitationModel/tenantinvitation.service.js";
import {
  createTenantUserService,
  findTenantUserByIdService,
  updateTenantUserService,
} from "../TenantUserModel/tenantuser.service.js";

export const createTenantController = async (req, res) => {
  const loginUSer = req.user;

  try {
    const {
      company_name,
      owner_name,
      owner_email,
      owner_country_code,
      owner_mobile,
      type,
      subscription_start_date,
      subscription_end_date,
      profile,
    } = req.body;

    const requiredFields = {
      company_name,
      owner_name,
      owner_email,
      owner_country_code,
      owner_mobile,
      type,
    };

    const missingFields = await missingFieldsChecker(requiredFields);
    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    const tenant_id = await generateReadableIdFromLast(
      tableNames.TENANTS,
      "tenant_id",
      "TT",
    );

    const sanitizedMobile = formatPhoneNumber(owner_mobile);

    await createTenantService(
      tenant_id,
      company_name,
      owner_name,
      owner_email,
      owner_country_code,
      sanitizedMobile,
      type,
      subscription_start_date || null,
      subscription_end_date || null,
      profile || null,
    );

    const tenant_user_id = await generateReadableIdFromLast(
      tableNames.TENANT_USERS,
      "tenant_user_id",
      "TTU",
    );

    await createTenantUserService(
      tenant_user_id,
      tenant_id,
      owner_name,
      owner_email,
      owner_country_code,
      sanitizedMobile,
      profile || null,
      "tenant_admin",
    );

    await sendTenantInvitationService(
      tenant_id,
      tenant_user_id,
      owner_email,
      owner_name,
      company_name,
      loginUSer?.unique_id,
    );

    return res.status(200).json({
      message: "Tenant created successfully. Invitation email sent to owner.",
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
      message: "success",
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

    if (!response) {
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
    const {
      company_name,
      owner_name,
      owner_email,
      owner_country_code,
      owner_mobile,
      type,
    } = req.body;

    const tenant = await findTenantByIdService(id);

    if (!tenant) {
      return res.status(404).json({ message: "Tenant details not found" });
    }

    const sanitizedMobile = owner_mobile ? formatPhoneNumber(owner_mobile) : null;

    await updateTenantService(
      company_name,
      owner_name,
      owner_email,
      owner_country_code,
      sanitizedMobile,
      type,
      id,
    );

    // Sync changes to the primary tenant admin user
    await updateTenantUserService(
      owner_name,
      owner_email,
      sanitizedMobile,
      owner_country_code,
      tenant?.owner_email, // old email used as identifier
    );

    return res.status(200).send({
      message: "Tenant updated successfully",
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res.status(400).json({ message: "Email or mobile already exists" });
    }

    return res.status(500).json({
      message: err.message,
    });
  }
};

// export const updateTenantStatusController = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { status } = req.query;

//     if (!status) {
//       return res.status(400).send({
//         message: "Status is required",
//       });
//     }

//     if (!["active", "inactive", "rejected", "suspended"].includes(status)) {
//       return res.status(400).send({
//         message: "Invalid status",
//       });
//     }

//     await updateTenantStatusService(status, id);

//     return res.status(200).send({
//       message: "Tentnat status updated successfully",
//     });
//   } catch (err) {
//     res.status(500).send({ error: err.message });
//   }
// };

export const deleteTenantStatusController = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await findTenantByIdService(id);

    if (!response) {
      return res.status(400).json({ message: "Tenant details not found" });
    }

    await deleteTenantStatusService(id);
    return res.status(200).send({
      message: "Tentnat removed successfully",
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

export const resendTenantInvitationController = async (req, res) => {
  const { tenant_user_id } = req.params;

  if (!tenant_user_id) {
    return res.status(400).send({
      message: "Tenant user id invalid",
    });
  }

  try {
    const loginUSer = req.user;

    const tenantUser = await findTenantUserByIdService(tenant_user_id);
    if (!tenantUser) {
      return res.status(404).send({
        message: "Tenant user not found",
      });
    }

    const tenant = await findTenantByIdService(tenantUser.tenant_id);
    if (!tenant) {
      return res.status(404).send({
        message: "Tenant not found",
      });
    }

    await sendTenantInvitationService(
      tenantUser.tenant_id,
      tenant_user_id,
      tenantUser.email,
      tenantUser.name,
      tenant.company_name,
      loginUSer?.unique_id,
    );

    return res.status(200).send({
      message: "Invitation resent successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
