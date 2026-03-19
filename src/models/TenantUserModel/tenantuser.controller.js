import { tableNames } from "../../database/tableName.js";
import {
  generateAccessToken,
  generateInviteToken,
  generateRefreshToken,
} from "../../middlewares/auth/authMiddlewares.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";
import {
  sendTenantInvitationService,
  sendTenantUserWelcomeEmailService,
} from "../TenantInvitationModel/tenantinvitation.service.js";
import { findTenantByIdService, updateTenantService } from "../TenantModel/tenant.service.js";
import {
  createTenantUserService,
  findTenantUserByIdService,
  getAllTenantUsersService,
  loginTenantUserService,
  permanentDeleteTenantUserService,
  softDeleteTenantUserService,
  updateTenantUserByIdService,
  findTenantAdminService,
  findTenantUserByEmailGloballyService,
  getDeletedTenantUserListService,
  restoreTenantUserService,
} from "./tenantuser.service.js";
import bcrypt from "bcrypt";
import { generatePassword } from "../../utils/helpers/generatePassword.js";
import crypto from "crypto";
import {
  normalizeMobile,
  cleanCountryCode,
} from "../../utils/helpers/normalizeMobile.js";

export const getLoggedTenantUserController = async (req, res) => {
  try {
    const { unique_id } = req.user;

    if (!unique_id) {
      return res
        .status(400)
        .json({ message: "Tenant user ID not found in session" });
    }

    const user = await findTenantUserByIdService(unique_id);

    if (!user) {
      return res.status(404).json({ message: "User profile not found" });
    }

    // Remove sensitive data
    delete user.password_hash;

    // Fetch full tenant details for organization profile
    const tenant = await findTenantByIdService(user.tenant_id);
    const organization = tenant ? { ...tenant } : null;

    return res.status(200).send({
      message: "Logged-in tenant user profile fetched successfully",
      data: { ...user, organization, user_type: "tenant" },
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
};

export const updateLoggedTenantOrganizationController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const { company_name, type, address, city, state, country, pincode } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ message: "Tenant ID required" });
    }

    // Call updateTenantService with ONLY the allowed fields
    await updateTenantService(
      company_name,
      null, // owner_name (not allowed from here)
      null, // owner_email (not allowed from here)
      null, // owner_country_code
      null, // owner_mobile
      type,
      null, // status (PROTECTED)
      null, // sub_start
      null, // sub_end
      address,
      city,
      country,
      state,
      pincode,
      null, // max_users (PROTECTED)
      null, // sub_plan (PROTECTED)
      null, // profile
      tenant_id
    );

    return res.status(200).json({ message: "Organization updated successfully" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const createTenantUserController = async (req, res) => {
  const { title, username, email, country_code, mobile, profile, role } =
    req.body;

  const tenant_id = req.user.tenant_id;
  const loginuser = req.user;

  if (!tenant_id) {
    return res.status(400).send({
      message: "Tenant id required",
    });
  }

  const requiredFields = {
    tenant_id,
    username,
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

  const trimmedEmail = email?.trim()?.toLowerCase();

  const existingUserGlobally =
    await findTenantUserByEmailGloballyService(trimmedEmail);
  if (existingUserGlobally) {
    return res.status(400).send({
      message: "This email is already registered with another organization.",
    });
  }

  const getloginuserDetails = await findTenantByIdService(loginuser?.tenant_id);

  if (!getloginuserDetails) {
    return res.status(400).send({
      message: "Tenant details required",
    });
  }

  // Check if tenant_admin already exists
  if (role === "tenant_admin") {
    const existingAdmin = await findTenantAdminService(tenant_id);
    if (existingAdmin) {
      return res.status(400).send({
        message: "Tenant admin already exists for this organization.",
      });
    }
  }

  const tenant_user_id = await generateReadableIdFromLast(
    tableNames.TENANT_USERS,
    "tenant_user_id",
    "TTU",
  );

  const cleanedCC = cleanCountryCode(country_code);
  const normalizedMobile = normalizeMobile(cleanedCC, mobile);

  try {
    let password_hash = null;
    let auto_generated_password = null;
    let user_status = "inactive";

    if (role !== "tenant_admin") {
      const generated = await generatePassword();
      auto_generated_password = generated.password?.trim(); // Ensure clean password
      password_hash = await bcrypt.hash(auto_generated_password, 10);
      user_status = "active";
    }

    await createTenantUserService(
      tenant_user_id,
      tenant_id,
      title || null,
      username,
      trimmedEmail,
      cleanedCC,
      normalizedMobile,
      profile || null,
      role,
      password_hash,
      user_status,
    );

    if (role === "tenant_admin") {
      // Send invitation link flow for admins
      await sendTenantInvitationService(
        tenant_id,
        tenant_user_id,
        trimmedEmail,
        username,
        getloginuserDetails?.company_name,
        loginuser?.unique_id,
      );
    } else {
      // Send direct credentials for other roles
      await sendTenantUserWelcomeEmailService(
        trimmedEmail,
        username,
        getloginuserDetails?.company_name,
        auto_generated_password,
        role,
      );
    }

    return res.status(200).send({
      message:
        role === "tenant_admin"
          ? "Tenant user invited successfully. Invitation email sent."
          : `Tenant user created successfully. Credentials sent to ${email}`,
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

    const trimmedEmail = email?.trim()?.toLowerCase();
    const trimmedPassword = password?.trim();

    const user = await loginTenantUserService(trimmedEmail);

    if (!user) {
      console.log(`[LOGIN-DEBUG] User not found for email: ${trimmedEmail}`);
      return res.status(401).send({
        message: "Invalid email or password",
      });
    }

    if (user.status !== "active") {
      console.log(
        `[LOGIN-DEBUG] User ${trimmedEmail} is inactive. Status: ${user.status}`,
      );
      return res.status(403).send({
        message: "Account is inactive. Please contact administration.",
      });
    }

    const isMatch = await bcrypt.compare(trimmedPassword, user.password_hash);
    if (!isMatch) {
      console.log(`[LOGIN-DEBUG] Password mismatch for user: ${trimmedEmail}`);
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

    const userDetails = { ...user, user_type: "tenant" };
    delete userDetails.password_hash;

    // Fetch tenant details for company name and webhook status
    const tenant = await findTenantByIdService(user.tenant_id);
    if (!tenant) {
      console.log(`[LOGIN-DEBUG] Tenant not found for user: ${user.tenant_id}`);
      return res.status(403).send({
        message: "Organization details not found.",
      });
    }

    if (["inactive", "suspended", "expired", "rejected"].includes(tenant.status)) {
      console.log(`[LOGIN-DEBUG] Tenant ${tenant.tenant_id} is ${tenant.status}`);
      return res.status(403).send({
        message: `Your organization is ${tenant.status}. Please contact administration.`,
      });
    }

    if (tenant) {
      userDetails.company_name = tenant.company_name;
      userDetails.webhook_verified = !!tenant.webhook_verified;
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

    const user = await findTenantUserByIdService(id);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // 🔒 Security Check: Ensure the requested user belongs to the same tenant
    if (user.tenant_id !== loginUser.tenant_id) {
      return res
        .status(403)
        .send({
          message: "Access denied: User belongs to a different organization",
        });
    }

    // Remove sensitive data
    delete user.password_hash;

    // Fetch tenant details for webhook status
    const tenant = await findTenantByIdService(user.tenant_id);
    if (tenant) {
      user.webhook_verified = !!tenant.webhook_verified;
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

    const user = await findTenantUserByIdService(id);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // 🔒 Security Check: Ensure the target user belongs to the same tenant
    if (user.tenant_id !== loginUser.tenant_id) {
      return res
        .status(403)
        .send({
          message: "Access denied: User belongs to a different organization",
        });
    }

    // 🔒 Security Check: Only admins or the user themselves can update
    if (loginUser.role !== "tenant_admin" && loginUser.unique_id !== id) {
      return res.status(403).send({ message: "Access denied" });
    }

    // role or status change only for tenant_admin
    if (
      loginUser.role !== "tenant_admin" &&
      (req.body.role || req.body.status)
    ) {
      return res.status(403).send({
        message: "You do not have permission to change role or status",
      });
    }

    if (req.body.country_code) {
      req.body.country_code = cleanCountryCode(req.body.country_code);
    }
    if (req.body.mobile && req.body.country_code) {
      req.body.mobile = normalizeMobile(req.body.country_code, req.body.mobile);
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

    const user = await findTenantUserByIdService(id);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // 🔒 Security Check: Ensure target user belongs to the same tenant
    if (user.tenant_id !== loginUser.tenant_id) {
      return res
        .status(403)
        .send({
          message: "Access denied: User belongs to a different organization",
        });
    }

    if (loginUser.tenant_user_id === id) {
      return res.status(400).send({
        message: "Tenant user cannot delete himself",
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

    const user = await findTenantUserByIdService(id);

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    // 🔒 Security Check: Ensure target user belongs to the same tenant
    if (user.tenant_id !== loginUser.tenant_id) {
      return res
        .status(403)
        .send({
          message: "Access denied: User belongs to a different organization",
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

export const getDeletedTenantUserListController = async (req, res) => {
  try {
    const { tenant_id } = req.user;
    const users = await getDeletedTenantUserListService(tenant_id);

    return res.status(200).send({
      message: "Deleted tenant users fetched successfully",
      data: users,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const restoreTenantUserController = async (req, res) => {
  const { id } = req.params;

  try {
    await restoreTenantUserService(id);

    return res.status(200).send({
      message: "Tenant user restored successfully",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

// --- Password Reset Controllers ---

import {
  generateOTPService,
  verifyOTPService,
  checkOTPVerificationService,
} from "../OtpVerificationModel/otpverification.service.js";
import { updateTenantPasswordService } from "./tenantuser.service.js";

export const forgotTenantPasswordController = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    const trimmedEmail = email?.trim()?.toLowerCase();
    const user = await loginTenantUserService(trimmedEmail);
    if (!user) {
      return res.status(400).send({
        message: "Invalid email",
      });
    }

    await generateOTPService(trimmedEmail, "tenant");

    return res.status(200).send({
      message: "OTP sent to your email",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const verifyTenantOTPController = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).send({ message: "Email and OTP are required" });
    }

    const trimmedEmail = email?.trim()?.toLowerCase();
    const verification = await verifyOTPService(trimmedEmail, otp, "tenant");

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

export const resetTenantPasswordController = async (req, res) => {
  try {
    const { email, new_password } = req.body;
    if (!email || !new_password) {
      return res
        .status(400)
        .send({ message: "Email and new password are required" });
    }

    const trimmedEmail = email?.trim()?.toLowerCase();
    const trimmedPassword = new_password?.trim();

    // Verify if OTP was verified recently
    const isVerified = await checkOTPVerificationService(
      trimmedEmail,
      "tenant",
    );
    if (!isVerified) {
      return res.status(400).send({
        message: "Please verify OTP first or OTP session expired",
      });
    }

    const user = await loginTenantUserService(trimmedEmail);
    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(trimmedPassword, 10);
    await updateTenantPasswordService(user.tenant_user_id, hashedPassword);

    return res.status(200).send({
      message: "Password reset successfully. Please login with new password.",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};
