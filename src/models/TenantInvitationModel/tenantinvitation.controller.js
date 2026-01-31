import crypto from "crypto";
import bcrypt from "bcrypt";

import {
  getInvitationByTokenHashService,
  updateInvitationStatusService,
} from "../TenantInvitationModel/tenantinvitation.service.js";
import {
  activateTenantUserService,
  findTenantUserByIdService,
  updateTenantUserPasswordService,
} from "../TenantUserModel/tenantUser.service.js";
import {
  activateTenantService,
  findTenantByIdService,
} from "../TenantModel/tenant.service.js";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../middlewares/auth/authMiddlewares.js";

export const verifyTenantInvitationController = async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send({
      valid: false,
      message: "Token is required",
    });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await getInvitationByTokenHashService(tokenHash);

    if (!invitation) {
      return res.status(404).send({
        valid: false,
        message: "Invitation link is invalid",
      });
    }

    const [getTenantDetails, getTenantUserDetails] = await Promise.all([
      findTenantByIdService(invitation.tenant_id),
      findTenantUserByIdService(invitation.tenant_user_id),
    ]);

    if (!getTenantDetails || !getTenantUserDetails) {
      return res.status(403).send({
        valid: false,
        message: "Invitation details are incomplete or invalid",
      });
    }

    if (invitation.status !== "pending" && invitation.status !== "accepted") {
      return res.status(403).send({
        valid: false,
        status: invitation.status,
        message: "Invitation is no longer usable",
        company_name: getTenantDetails?.company_name,
        owner_name: getTenantDetails?.owner_name,
        email: invitation.email,
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await updateInvitationStatusService(invitation?.invitation_id, "expired");

      return res.status(403).send({
        valid: false,
        status: "expired",
        message: "Invitation link has expired",
        company_name: getTenantDetails?.company_name,
        owner_name: getTenantDetails?.owner_name,
        email: invitation.email,
      });
    }

    if (
      invitation.status === "accepted" &&
      !getTenantUserDetails?.password_hash
    ) {
      return res.status(200).send({
        valid: true,
        status: invitation.status,
        is_password: false,
        message: "one step to complete access process",
        company_name: getTenantDetails?.company_name,
        owner_name: getTenantDetails?.owner_name,
        email: invitation.email,
      });
    }

    if (
      invitation.status === "accepted" &&
      getTenantUserDetails?.password_hash
    ) {
      return res.status(403).send({
        valid: false,
        status: invitation.status,
        is_password: true,
        message: "Invitation is no longer usable",
        company_name: getTenantDetails?.company_name,
        owner_name: getTenantDetails?.owner_name,
        email: invitation.email,
      });
    }

    return res.status(200).send({
      message: "success",
      valid: true,
      status: invitation?.status,
      is_password: false,
      company_name: getTenantDetails?.company_name,
      owner_name: getTenantDetails?.owner_name,
      email: invitation.email,
    });
  } catch (err) {
    return res.status(500).send({
      valid: false,
      message: err?.message,
    });
  }
};

export const acceptTenantInvitationController = async (req, res) => {
  try {
    const { token } = req.body;

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await getInvitationByTokenHashService(tokenHash);

    if (!invitation || invitation.status !== "pending") {
      return res.status(403).send({
        valid: false,
        message: "Invalid invitation",
      });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await updateInvitationStatusService(invitation?.invitation_id, "expired");

      return res.status(403).send({
        valid: false,
        message: "Invitation expired",
      });
    }

    await updateInvitationStatusService(invitation.invitation_id, "accepted");
    await activateTenantUserService(invitation.tenant_user_id);
    await activateTenantService(invitation.tenant_id);

    return res.status(200).send({
      valid: true,
      message: "Invitation accepted. Please set your password",
    });
  } catch (err) {
    return res.status(500).send({
      valid: false,
      message: err?.message,
    });
  }
};

export const rejectTenantInvitationController = async (req, res) => {
  try {
    const { token } = req.body;

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await getInvitationByTokenHashService(tokenHash);

    if (!invitation || invitation.status !== "pending") {
      return res.status(403).send({
        valid: false,
        message: "Invalid invitation",
      });
    }

    await updateInvitationStatusService(invitation.invitation_id, "revoked");

    return res.status(200).send({
      valid: false,
      message: "Invitation rejected successfully",
    });
  } catch (err) {
    return res.status(500).send({
      valid: false,
      message: err?.message,
    });
  }
};

export const setTenantPasswordController = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!password) {
      return res.status(400).send({
        valid: false,
        message: "Password required",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await getInvitationByTokenHashService(tokenHash);

    if (!invitation || invitation.status !== "accepted") {
      return res.status(403).send({
        valid: false,
        message: "Invalid invitation",
      });
    }

    const tenantuserpaylod = await findTenantUserByIdService(
      invitation.tenant_user_id,
    );

    if (!tenantuserpaylod) {
      return res.status(400).send({
        valid: false,
        message: "Invalid tenant user",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await updateTenantUserPasswordService(
      passwordHash,
      invitation.tenant_user_id,
    );

    // Update invitation status to completed
    await updateInvitationStatusService(invitation.invitation_id, "completed");

    // Fetch full user details (similar to login)
    const user = await findTenantUserByIdService(invitation.tenant_user_id);
    const userDetails = { ...user };
    delete userDetails.password_hash;

    // Fetch tenant details for company name
    const tenant = await findTenantByIdService(invitation.tenant_id);
    if (tenant) {
      userDetails.company_name = tenant.company_name;
    }

    const tokenPayload = {
      id: user.id,
      unique_id: user.tenant_user_id,
      user_type: "tenant",
      tenant_id: invitation.tenant_id,
      role: user.role,
    };

    return res.status(200).send({
      valid: true,
      message: "Password set successfully",
      user: userDetails,
      tokens: {
        accessToken: generateAccessToken(tokenPayload),
        refreshToken: generateRefreshToken(tokenPayload),
      },
    });
  } catch (err) {
    return res.status(500).send({
      valid: false,
      message: err?.message,
    });
  }
};
