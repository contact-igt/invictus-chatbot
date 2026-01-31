import bcrypt from "bcrypt";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../middlewares/auth/authMiddlewares.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";
import { missingFieldsChecker } from "../../utils/missingFields.js";
import {
  loginManagementService,
  registerManagementService,
  getAllManagementService,
  getManagementByIdService,
  getAllManagementAdminService,
  updateManagementService,
  updateDeleteStatusByIdService,
  deleteManagmentByIdService,
  updateManagementPasswordService,
} from "./management.service.js";
import { tableNames } from "../../database/tableName.js";
import { generatePassword } from "../../utils/generatePassword.js";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import { fileURLToPath } from "url";
import { sendEmail } from "../../utils/emailService.js";

export const registerManagementController = async (req, res) => {
  try {
    const { title, username, email, country_code, mobile, role } = req.body;

    const requiredFields = { username, email, country_code, mobile, role };
    const missing = await missingFieldsChecker(requiredFields);

    if (missing.length) {
      return res.status(400).send({
        message: `Missing fields: ${missing.join(", ")}`,
      });
    }

    if (!["platform_admin", "super_admin"].includes(role)) {
      return res.status(403).send({
        message: "Invalid management role",
      });
    }

    const management_id = await generateReadableIdFromLast(
      tableNames.MANAGEMENT,
      "management_id",
      "MG",
    );

    const usePassword = await generatePassword();

    await registerManagementService(
      management_id,
      title || null,
      username,
      email,
      country_code || null,
      mobile || null,
      usePassword?.hashedPassword,
      role,
    );

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const templatePath = path.join(
      __dirname,
      "../../../public/html/managementInvite/index.html",
    );

    const source = fs.readFileSync(templatePath, "utf8");
    const template = handlebars.compile(source);

    const emailHtml = template({
      admin_name: username,
      admin_role: role,
      admin_email: email,
      admin_password: usePassword?.password,
    });

    await sendEmail({
      to: email,
      subject: `You're invited to manage WhatsNexus`,
      html: emailHtml,
    });

    return res.status(201).send({
      message: "Management user created successfully",
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

export const loginManagementController = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send({
        message: "Email and password are required",
      });
    }

    const user = await loginManagementService(email);

    if (!user) {
      return res.status(401).send({
        message: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).send({
        message: "Invalid email or password",
      });
    }

    const tokenPayload = {
      id: user.id,
      unique_id: user.management_id,
      user_type: "management",
      tenant_id: null,
      role: user.role,
    };

    const userDetails = { ...user };
    delete userDetails.password;

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

export const getManagementController = async (req, res) => {
  try {
    if (
      req.user.user_type === "management" &&
      req.user.role === "platform_admin"
    ) {
      const data = await getAllManagementAdminService(req.user.role);
      return res.status(200).send({
        message: "success",
        data,
      });
    } else {
      const data = await getAllManagementService();

      return res.status(200).send({
        message: "success",
        data,
      });
    }
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const getManagementByIdController = async (req, res) => {
  try {
    const data = await getManagementByIdService(req.params.id);

    return res.status(200).send({
      message: "success",
      data,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const updateManagementController = async (req, res) => {
  try {
    const loggedInUser = req.user;
    const targetUserId = req.params.id;

    const { title, username, country_code, mobile, profile } = req.body;

    if (
      loggedInUser.role === "platform_admin" &&
      targetUserId !== loggedInUser.unique_id
    ) {
      return res.status(403).send({
        message: "You can update only your own profile",
      });
    }

    if (loggedInUser.role === "platform_admin" && req.body.role) {
      return res.status(403).send({
        message: "You cannot change role",
      });
    }

    await updateManagementService(
      targetUserId,
      title,
      username,
      country_code,
      mobile,
      profile,
      loggedInUser.role === "super_admin" && req.body.role
        ? req.body.role
        : null,
      loggedInUser.role === "super_admin" && req.body.status
        ? req.body.status
        : null
    );

    return res.status(200).send({
      message: "Management profile updated successfully",
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

export const updateDeleteStatusByIdController = async (req, res) => {
  const management_id = req.params.id;

  if (!management_id) {
    return res.status(400).send({
      message: "Management id invalid",
    });
  }

  try {
    await updateDeleteStatusByIdService(management_id);

    return res.status(200).send({
      message: "Deleted management successfully",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const deleteManagmentByIdController = async (req, res) => {
  const management_id = req.params.id;

  if (!management_id) {
    return res.status(400).send({
      message: "Management id invalid",
    });
  }

  try {
    await deleteManagmentByIdService(management_id);

    return res.status(200).send({
      message: "Permenantly deleted management successfully",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};
