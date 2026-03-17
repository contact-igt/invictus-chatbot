import bcrypt from "bcrypt";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../middlewares/auth/authMiddlewares.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import {
  updateManagementService,
  softDeleteManagementService,
  deleteManagmentByIdService,
  updateManagementPasswordService,
  findManagementByEmailService,
  findManagementByEmailOrMobileService,
  registerManagementService,
  loginManagementService,
  getAllManagementAdminService,
  getAllManagementService,
  getManagementByIdService,
  getDeletedManagementListService,
  restoreManagementService,
  getPricingRulesService,
  createPricingRuleService,
  updatePricingRuleService,
  deletePricingRuleService,
} from "./management.service.js";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generatePassword } from "../../utils/helpers/generatePassword.js";
import { getTemplate } from "../../utils/email/templateLoader.js";
import { sendEmail } from "../../utils/email/emailService.js";
import { normalizeMobile, cleanCountryCode } from "../../utils/helpers/normalizeMobile.js";
import {
  generateOTPService,
  verifyOTPService,
  checkOTPVerificationService,
} from "../OtpVerificationModel/otpverification.service.js";



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

    const trimmedEmail = email?.trim()?.toLowerCase();
    const normalizedMobile = normalizeMobile(country_code, mobile);
    const cleanedCC = country_code ? cleanCountryCode(country_code) : null;

    const existingMg = await findManagementByEmailOrMobileService(
      trimmedEmail,
      normalizedMobile,
    );

    if (existingMg) {
      const field = existingMg.email === trimmedEmail ? "Email" : "Mobile";
      return res.status(400).send({
        message: `${field} already exists in Management records`,
      });
    }

    const management_id = await generateReadableIdFromLast(
      tableNames.MANAGEMENT,
      "management_id",
      "MG",
    );

    const usePassword = await generatePassword();
    const cleanPassword = usePassword?.password?.trim();
    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    await registerManagementService(
      management_id,
      title || null,
      username,
      trimmedEmail,
      cleanedCC,
      normalizedMobile || null,
      hashedPassword,
      role,
    );

    const template = getTemplate("managementInvite");

    const emailHtml = template({
      admin_name: username,
      admin_role: role,
      admin_email: trimmedEmail,
      admin_password: cleanPassword,
    });

    await sendEmail({
      to: email,
      subject: `You're invited to manage WhatsNexus`,
      html: emailHtml,
    });

    return res.status(200).send({
      message: "Management user created successfully",
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res.status(400).send({
        message: "This email or mobile number is already registered.",
      });
    }

    return res
      .status(500)
      .send({ message: "An internal server error occurred." });
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

    const trimmedEmail = email?.trim()?.toLowerCase();
    const trimmedPassword = password?.trim();

    const user = await loginManagementService(trimmedEmail);

    if (!user) {
      return res.status(401).send({
        message: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(trimmedPassword, user.password);

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

    const userDetails = { ...user, user_type: "management" };
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

export const getAllManagementController = async (req, res) => {
  try {
    const response = await getAllManagementService();

    return res.status(200).send({
      message: "Management users fetched successfully",
      data: response.users,
    });
  } catch (err) {
    return res.status(500).send({
      message: "An internal server error occurred.",
    });
  }
};

export const getManagementByIdController = async (req, res) => {
  try {
    const data = await getManagementByIdService(req.params.id);

    return res.status(200).send({
      message: "Management user fetched successfully",
      data,
    });
  } catch (err) {
    return res
      .status(500)
      .send({ message: "An internal server error occurred." });
  }
};

export const getLoggedManagementController = async (req, res) => {
  try {
    const { unique_id } = req.user;

    if (!unique_id) {
      return res.status(400).send({
        message: "Management ID not found in session",
      });
    }

    const data = await getManagementByIdService(unique_id);

    if (!data) {
      return res.status(404).send({
        message: "Management user not found",
      });
    }

    const userDetails = { ...data, user_type: "management" };
    delete userDetails.password;

    return res.status(200).send({
      message: "Logged-in management profile fetched successfully",
      data: userDetails,
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

    if (loggedInUser.role === "platform_admin") {
      if (targetUserId !== loggedInUser.unique_id) {
        return res.status(403).send({
          message: "You can update only your own profile",
        });
      }

      if (req.body.role || req.body.status) {
        return res.status(403).send({
          message: "You do not have permission to change role or status",
        });
      }
    }

    const cleanedCC = country_code ? cleanCountryCode(country_code) : null;

    await updateManagementService(
      targetUserId,
      title,
      username,
      cleanedCC,
      normalizeMobile(cleanedCC, mobile),
      profile,
      loggedInUser.role === "super_admin" && req.body.role
        ? req.body.role
        : null,
      loggedInUser.role === "super_admin" && req.body.status
        ? req.body.status
        : null,
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

export const softDeleteManagementController = async (req, res) => {
  const management_id = req.params.id;

  if (!management_id) {
    return res.status(400).send({
      message: "Management id invalid",
    });
  }

  try {
    await softDeleteManagementService(management_id);

    return res.status(200).send({
      message: "Deleted management successfully",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const getDeletedManagementListController = async (req, res) => {
  try {
    const data = await getDeletedManagementListService();
    return res.status(200).send({
      message: "Deleted management users fetched successfully",
      data,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const restoreManagementController = async (req, res) => {
  const management_id = req.params.id;

  if (!management_id) {
    return res.status(400).send({
      message: "Management id invalid",
    });
  }

  try {
    await restoreManagementService(management_id);

    return res.status(200).send({
      message: "Management user restored successfully",
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



export const forgotManagementPasswordController = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    const trimmedEmail = email?.trim()?.toLowerCase();
    const user = await loginManagementService(trimmedEmail);
    if (!user) {
      return res.status(400).send({
        message: "Invalid email",
      });
    }

    await generateOTPService(trimmedEmail, "management");

    return res.status(200).send({
      message: "OTP sent to your email",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const verifyManagementOTPController = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).send({ message: "Email and OTP are required" });
    }

    const trimmedEmail = email?.trim()?.toLowerCase();
    const verification = await verifyOTPService(
      trimmedEmail,
      otp,
      "management",
    );

    if (!verification.valid) {
      return res.status(400).send({ message: verification.message });
    }

    return res.status(200).send({
      message: "OTP verified successfully",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const resetManagementPasswordController = async (req, res) => {
  try {
    const { email, new_password } = req.body;
    if (!email || !new_password) {
      return res
        .status(400)
        .send({ message: "Email and new password are required" });
    }

    const trimmedEmail = email?.trim()?.toLowerCase();
    const trimmedPassword = new_password?.trim();

    const isVerified = await checkOTPVerificationService(
      trimmedEmail,
      "management",
    );
    if (!isVerified) {
      return res.status(400).send({
        message: "Please verify OTP first or OTP session expired",
      });
    }

    const user = await loginManagementService(trimmedEmail);
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(trimmedPassword, 10);
    await updateManagementPasswordService(user.management_id, hashedPassword);

    return res.status(200).send({
      message: "Password reset successfully. Please login with new password.",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

// ─── Pricing Table CRUD Controllers ─────────────────────────────

export const getPricingRulesController = async (req, res) => {
  try {
    const rules = await getPricingRulesService();
    return res.status(200).json({ success: true, data: rules });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const createPricingRuleController = async (req, res) => {
  try {
    const { category, country, rate, markup_percent } = req.body;
    if (!category || !country || rate === undefined) {
      return res.status(400).json({ success: false, message: "category, country, and rate are required" });
    }
    await createPricingRuleService(category, country, rate, markup_percent || 0);
    return res.status(201).json({ success: true, message: "Pricing rule created" });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const updatePricingRuleController = async (req, res) => {
  try {
    const { id } = req.params;
    const { rate, markup_percent } = req.body;
    await updatePricingRuleService(id, rate, markup_percent);
    return res.status(200).json({ success: true, message: "Pricing rule updated" });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const deletePricingRuleController = async (req, res) => {
  try {
    const { id } = req.params;
    await deletePricingRuleService(id);
    return res.status(200).json({ success: true, message: "Pricing rule deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
