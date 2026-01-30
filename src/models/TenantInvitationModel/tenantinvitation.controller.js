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
    return res.status(400).send({ message: "Token is required" });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await getInvitationByTokenHashService(tokenHash);

    const getTenantDetails = await findTenantByIdService(invitation?.tenant_id);

    const getTenantUserDetails = await findTenantUserByIdService(
      invitation?.tenant_user_id,
    );

    if (!invitation) {
      return res.status(404).send({
        valid: false,
        message: "Invitation link is invalid",
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

    if (!getTenantDetails) {
      return res.status(403).send({
        message: "Tenant details invalid",
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
      // tenant_id: invitation.tenant_id,
      // tenant_user_id: invitation.tenant_user_id,
    });
  } catch (err) {
    return res.status(500).send({
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
      return res.status(403).send({ message: "Invalid invitation" });
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await updateInvitationStatusService(invitation?.invitation_id, "expired");

      return res.status(403).send({ message: "Invitation expired" });
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
      return res.status(403).send({ message: "Invalid invitation" });
    }

    await updateInvitationStatusService(invitation.invitation_id, "revoked");

    return res.status(200).send({
      valid: false,
      message: "Invitation rejected successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const setTenantPasswordController = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!password) {
      return res.status(400).send({ message: "Password required" });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const invitation = await getInvitationByTokenHashService(tokenHash);

    if (!invitation || invitation.status !== "accepted") {
      return res.status(403).send({ message: "Invalid invitation" });
    }

    const tenantuserpaylod = await findTenantUserByIdService(
      invitation.tenant_user_id,
    );

    if (!tenantuserpaylod) {
      return res.status(400).send({
        message: "Invalid tenant user",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await updateTenantUserPasswordService(
      passwordHash,
      invitation.tenant_user_id,
    );

    const payload = {
      id: tenantuserpaylod?.id,
      unique_id: tenantuserpaylod?.tenant_user_id,
      user_type: "tenant",
      tenant_id: invitation.tenant_id,
      role: tenantuserpaylod?.role,
    };

    return res.status(200).send({
      message: "Password set successfully",
      user: payload,
      accessToken: generateAccessToken(payload),
      refreshToken: generateRefreshToken(payload),
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
