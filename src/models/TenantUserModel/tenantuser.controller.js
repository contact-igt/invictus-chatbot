import { tableNames } from "../../database/tableName.js";
import {
  generateAccessToken,
  generateInviteToken,
  generateRefreshToken,
} from "../../middlewares/auth/authMiddlewares.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";
import { missingFieldsChecker } from "../../utils/missingFields.js";
import {
  sendTenantInvitationService,
} from "../TenantInvitationModel/tenantinvitation.service.js";
import { findTenantByIdService } from "../TenantModel/tenant.service.js";
import {
  createTenantUserService,
  findTenantUserByIdService,
  getAllTenantUsersService,
  loginTenantUserService,
  permanentDeleteTenantUserService,
  softDeleteTenantUserService,
  updateTenantUserByIdService,
} from "./tenantUser.service.js";
import bcrypt from "bcrypt";
import crypto from "crypto";

import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import { fileURLToPath } from "url";
import { sendEmail } from "../../utils/emailService.js";

export const createTenantUsercontroller = async (req, res) => {
  const { name, email, country_code, mobile, profile, role } = req.body;

  const tenant_id = req.user.tenant_id;
  const loginuser = req.user;

  if (!tenant_id) {
    return res.status(400).send({
      message: "Tenant id required",
    });
  }

  const requiredFields = {
    tenant_id,
    name,
    email,
    country_code,
    mobile,
    role,
  };

  const missingFields = await missingFieldsChecker(requiredFields);
  if (missingFields.length > 0) {
    return res.status(400).send({
      message: `Missing required field(s): ${missingFields.join(", ")}`,
    });
  }

  const getloginuserDetails = await findTenantByIdService(loginuser?.tenant_id);

  if (!getloginuserDetails) {
    return res.status(400).send({
      message: "Tenant details required",
    });
  }

  const tenant_user_id = await generateReadableIdFromLast(
    tableNames.TENANT_USERS,
    "tenant_user_id",
    "TTU",
  );

  try {
    await createTenantUserService(
      tenant_user_id,
      tenant_id,
      name,
      email,
      country_code,
      mobile,
      profile || null,
      role,
    );

    await sendTenantInvitationService(
      tenant_id,
      tenant_user_id,
      email,
      name,
      getloginuserDetails?.company_name,
      loginuser?.unique_id,
    );

    return res.status(201).send({
      message: "Tenant created successfully. Invitation email sent to owner.",
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res.status(400).send({
        message: "Email or mobile already exists",
      });
    }

    return res.status(500).send({ message: err.message });
  }
};

export const loginTenantUserController = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send({
        message: "Email and password are required",
      });
    }

    const user = await loginTenantUserService(email);

    if (!user) {
      return res.status(401).send({
        message: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).send({
        message: "Invalid email or password",
      });
    }

    const tokenPayload = {
      id: user.id,
      unique_id: user.tenant_user_id,
      user_type: "tenant",
      tenant_id: user?.tenant_id,
      role: user.role,
    };

    const userDetails = { ...user };
    delete userDetails.password_hash;

    // Fetch tenant details for company name
    const tenant = await findTenantByIdService(user.tenant_id);
    if (tenant) {
      userDetails.company_name = tenant.company_name;
    }

    return res.status(200).send({
      message: "Login successful",
      user: userDetails,
      tokens: {
        accessToken: generateAccessToken(tokenPayload),
        refreshToken: generateRefreshToken(tokenPayload),
      },
    });
  } catch (err) {
    return res.status(500).send({ message: err?.message });
  }
};

export const getAllTenantUsersController = async (req, res) => {
  try {
    const user = req.user;

    if (user.role !== "tenant_admin") {
      return res.status(403).send({
        message: "Only tenant admin can view all users",
      });
    }

    const users = await getAllTenantUsersService(user.tenant_id);

    return res.status(200).send({
      message: "Tenant users fetched successfully",
      data: users,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const getTenantUserByIdController = async (req, res) => {
  try {
    const loginUser = req.user;
    const { id } = req.params;

    if (loginUser.role !== "tenant_admin" && loginUser.tenant_user_id !== id) {
      return res.status(403).send({ message: "Access denied" });
    }

    const user = await findTenantUserByIdService(id);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    return res.status(200).send({
      message: "Tenant user fetched",
      data: user,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const updateTenantUserByIdController = async (req, res) => {
  try {
    const loginUser = req.user;
    const { id } = req.params;

    if (loginUser.role !== "tenant_admin" && loginUser.unique_id !== id) {
      return res.status(403).send({ message: "Access denied" });
    }

    // role change only for tenant_admin
    if (loginUser.role !== "tenant_admin" && req.body.role) {
      return res.status(403).send({
        message: "You cannot change role",
      });
    }

    await updateTenantUserByIdService(id, req.body);

    return res.status(200).send({
      message: "Tenant user updated successfully",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const softDeleteTenantUserController = async (req, res) => {
  try {
    const loginUser = req.user;
    const { id } = req.params;

    if (loginUser.role !== "tenant_admin") {
      return res.status(403).send({
        message: "Only tenant admin can delete users",
      });
    }

    if (loginUser.tenant_user_id === id) {
      return res.status(400).send({
        message: "Tenant admin cannot delete himself",
      });
    }

    await softDeleteTenantUserService(id);

    return res.status(200).send({
      message: "Tenant user deleted successfully",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const permanentDeleteTenantUserController = async (req, res) => {
  try {
    const loginUser = req.user;
    const { id } = req.params;

    if (loginUser.role !== "tenant_admin") {
      return res.status(403).send({
        message: "Only tenant admin can permanently delete users",
      });
    }

    await permanentDeleteTenantUserService(id);

    return res.status(200).send({
      message: "Tenant user permanently deleted",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};
