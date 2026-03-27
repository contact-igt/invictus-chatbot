import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";
import crypto from "crypto";
import {
  createTenantService,
  deleteTenantService,
  softDeleteTenantService,
  findTenantByIdService,
  getAllTenantService,
  updateTenantService,
  updateTenantStatusService,
  getDeletedTenantListService,
  restoreTenantService,
  getTenantInvitationListService,
  getOnboardedTenantListService,
  getTenantSettingsService,
  updateTenantAiSettingsService,
} from "./tenant.service.js";

import {
  normalizeMobile,
  cleanCountryCode,
} from "../../utils/helpers/normalizeMobile.js";

import { sendTenantInvitationService } from "../TenantInvitationModel/tenantinvitation.service.js";
import {
  createTenantUserService, // Retained from original
  findTenantUserByIdService, // Retained from original
  softDeleteTenantUserService,
  softDeleteUsersByTenantIdService,
  updateTenantUserByIdService,
  findTenantUserByEmailOrMobileGloballyService,
  findTenantAdminService,
  updateUsersStatusByTenantIdService,
} from "../TenantUserModel/tenantuser.service.js";

import { getComprehensiveWebhookStatusService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { encrypt, decrypt, maskApiKey } from "../../utils/encryption.js";
import OpenAI from "openai";

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
      subscriptionStatus,
      subscription_start_date,
      subscription_end_date,
      address,
      city,
      country,
      state,
      pincode,
      maxUsers,
      subscriptionPlan,
      profile,
      ai_settings,
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

    const cleanedCC = cleanCountryCode(owner_country_code);
    const normalizedMobile = normalizeMobile(cleanedCC, owner_mobile);
    const trimmedEmail = owner_email?.trim()?.toLowerCase();

    // Check for existing user in Tenants
    const existingTu = await findTenantUserByEmailOrMobileGloballyService(
      trimmedEmail,
      normalizedMobile,
    );

    if (existingTu) {
      const field = existingTu.email === trimmedEmail ? "Email" : "Mobile";
      return res.status(400).json({
        message: `${field} already exists in Tenant records`,
      });
    }

    await createTenantService(
      tenant_id,
      company_name,
      owner_name,
      owner_email,
      cleanedCC,
      normalizedMobile,
      type,
      subscriptionStatus || "invited",
      subscription_start_date || null,
      subscription_end_date || null,
      address || null,
      city || null,
      country || null,
      state || null,
      pincode || null,
      maxUsers || 10,
      subscriptionPlan || "basic",
      profile || null,
      null, // verify_token
      (() => {
        if (!ai_settings) return null;
        const settings = { ...ai_settings };
        if (settings.openai_api_key) {
          settings.openai_api_key = encrypt(settings.openai_api_key);
        }
        return settings;
      })(),
    );

    const tenant_user_id = await generateReadableIdFromLast(
      tableNames.TENANT_USERS,
      "tenant_user_id",
      "TTU",
    );

    await createTenantUserService(
      tenant_user_id,
      tenant_id,
      "Mr", // Default title as Mr
      owner_name,
      owner_email,
      cleanedCC,
      normalizedMobile,
      profile || null,
      "tenant_admin",
      null, // password_hash — null until invitation is accepted
      "inactive", // user_status — inactive until invitation is accepted
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
      message: "Tenant details fetched successfully",
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
      subscriptionStatus,
      subscription_start_date,
      subscription_end_date,
      address,
      city,
      country,
      state,
      pincode,
      maxUsers,
      subscriptionPlan,
      profile,
      ai_settings,
    } = req.body;

    const tenant = await findTenantByIdService(id);

    if (!tenant) {
      return res.status(404).json({ message: "Tenant details not found" });
    }

    const cleanedCC = owner_country_code
      ? cleanCountryCode(owner_country_code)
      : null;
    const normalizedMobile = owner_mobile
      ? normalizeMobile(cleanedCC, owner_mobile)
      : null;

    const trimmedEmail = owner_email?.trim()?.toLowerCase();
    console.log(
      `[UPDATE TENANT] ID: ${id}, New Email: ${trimmedEmail}, Old Email: ${tenant.owner_email}`,
    );

    // Check for duplicate email if it's changing
    if (trimmedEmail && trimmedEmail !== tenant.owner_email) {
      const existingUser = await findTenantUserByEmailOrMobileGloballyService(
        trimmedEmail,
        null,
      );
      if (existingUser) {
        console.log(
          `[UPDATE TENANT] Duplicate email detected: ${trimmedEmail}`,
        );
        return res
          .status(400)
          .json({ message: "Email already in use by another account" });
      }
    }

    await updateTenantService(
      company_name,
      owner_name,
      trimmedEmail || owner_email,
      cleanedCC,
      normalizedMobile,
      type,
      subscriptionStatus,
      subscription_start_date,
      subscription_end_date,
      address,
      city,
      country,
      state,
      pincode,
      maxUsers,
      subscriptionPlan,
      profile,
      (() => {
        if (!ai_settings) return ai_settings;
        const settings = { ...ai_settings };
        if (settings.openai_api_key) {
          settings.openai_api_key = encrypt(settings.openai_api_key);
        }
        return settings;
      })(),
      id,
    );

    // Sync changes to the primary tenant admin user
    const tenantAdmin = await findTenantAdminService(id);
    console.log(
      `[UPDATE TENANT] Admin Found: ${tenantAdmin ? tenantAdmin.tenant_user_id : "NO"}`,
    );

    if (tenantAdmin) {
      await updateTenantUserByIdService(tenantAdmin.tenant_user_id, {
        username: owner_name,
        email: trimmedEmail || owner_email,
        mobile: normalizedMobile,
        country_code: cleanedCC,
      });
    }

    // If email changed and user hasn't registered yet, send a new invitation
    if (trimmedEmail && trimmedEmail !== tenant.owner_email) {
      if (tenantAdmin && !tenantAdmin.password_hash) {
        console.log(
          `[UPDATE TENANT] Sending new invitation to: ${trimmedEmail}`,
        );
        await sendTenantInvitationService(
          id,
          tenantAdmin.tenant_user_id,
          trimmedEmail,
          owner_name || tenantAdmin.username,
          company_name || tenant.company_name,
          req.user?.unique_id,
        );
      } else {
        console.log(
          `[UPDATE TENANT] Skip invitation (User already has password or no admin found)`,
        );
      }
    }

    return res.status(200).send({
      message: "Tenant updated successfully",
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ message: "Email or mobile already exists" });
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

    if (
      ![
        "invited",
        "active",
        "inactive",
        "rejected",
        "suspended",
        "trial",
        "expired",
        "pending_setup",
        "grace_period",
        "maintenance",
      ].includes(status)
    ) {
      return res.status(400).send({
        message: "Invalid status",
      });
    }

    // Wrap in transaction to ensure atomic status sync
    await db.sequelize.transaction(async (t) => {
      await updateTenantStatusService(status, id);

      // Sync status to the tenant's users
      let userStatus = "inactive";
      if (["active", "trial", "grace_period"].includes(status)) {
        userStatus = "active";
      }
      await updateUsersStatusByTenantIdService(id, userStatus);
    });

    return res.status(200).send({
      message: "Tenant status updated successfully",
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
};

export const softDeleteTenantController = async (req, res) => {
  try {
    const { id } = req.params;

    const response = await findTenantByIdService(id);

    if (!response) {
      return res.status(400).json({ message: "Tenant details not found" });
    }

    await softDeleteTenantService(id);
    // softDeleteTenantService already soft-deletes associated users

    return res.status(200).send({
      message: "Tenant and all associated users removed successfully",
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
};

export const getDeletedTenantListController = async (req, res) => {
  try {
    const data = await getDeletedTenantListService();
    return res.status(200).send({
      message: "Deleted tenants fetched successfully",
      data,
    });
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
};

export const restoreTenantController = async (req, res) => {
  try {
    const { id } = req.params;

    await restoreTenantService(id);
    return res.status(200).send({
      message: "Tenant restored successfully",
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
      message: "Tenant removed successfully",
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

    if (tenantUser.password_hash) {
      return res.status(400).send({
        message: "User is already registered and has set their password.",
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
      tenantUser.username,
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

export const getTenantWebhookStatusController = async (req, res) => {
  try {
    const loginUser = req.user;
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "Tenant ID is required" });
    }

    // 🔒 Security Check: A tenant user can only check their OWN webhook status
    if (loginUser.user_type === "tenant" && loginUser.tenant_id !== id) {
      return res.status(403).json({
        message:
          "Access denied: You can only check your own organization's status",
      });
    }

    // Use comprehensive status check
    const status = await getComprehensiveWebhookStatusService(id);

    return res.status(200).json({
      message: "success",
      data: status,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const getTenantInvitationListController = async (req, res) => {
  try {
    const data = await getTenantInvitationListService();
    return res.status(200).json({
      message: "success",
      data: data || [],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const getOnboardedTenantListController = async (req, res) => {
  try {
    const data = await getOnboardedTenantListService();
    return res.status(200).json({
      message: "success",
      data: data || [],
    });
  } catch (err) {
    console.error("Error in getOnboardedTenantListController:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getTenantSettingsController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    console.log(`[SETTINGS GET] tenant_id=${tenant_id}`);
    const settings = await getTenantSettingsService(tenant_id);
    if (!settings) return res.status(404).json({ message: "Tenant not found" });

    // NEVER send raw or encrypted key to frontend — only masked status
    if (settings.ai_settings) {
      const encryptedKey = settings.ai_settings.openai_api_key;
      if (encryptedKey) {
        try {
          const rawKey = decrypt(encryptedKey);
          settings.ai_settings.openai_api_key_masked = maskApiKey(rawKey);
          settings.ai_settings.has_openai_key = true;
        } catch {
          settings.ai_settings.openai_api_key_masked = "••••••••";
          settings.ai_settings.has_openai_key = true;
        }
      } else {
        settings.ai_settings.openai_api_key_masked = "";
        settings.ai_settings.has_openai_key = false;
      }
      delete settings.ai_settings.openai_api_key;
    }

    return res.status(200).json({ message: "success", data: settings });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const updateTenantAiSettingsController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { ai_settings } = req.body;

    // Validate model selections if provided
    if (ai_settings?.input_model || ai_settings?.output_model) {
      const activeModels = await db.AiPricing.findAll({
        where: { is_active: true },
        attributes: ["model"],
        raw: true,
      });
      const validModels = new Set(activeModels.map((m) => m.model));

      if (
        ai_settings.input_model &&
        !validModels.has(ai_settings.input_model)
      ) {
        return res.status(400).json({
          message: `Invalid input model: ${ai_settings.input_model}. Please select an active model.`,
        });
      }
      if (
        ai_settings.output_model &&
        !validModels.has(ai_settings.output_model)
      ) {
        return res.status(400).json({
          message: `Invalid output model: ${ai_settings.output_model}. Please select an active model.`,
        });
      }
    }

    await updateTenantAiSettingsService(tenant_id, ai_settings);

    // Return refreshed settings with masked key so frontend cache stays consistent
    const refreshed = await getTenantSettingsService(tenant_id);
    if (refreshed?.ai_settings) {
      const encryptedKey = refreshed.ai_settings.openai_api_key;
      if (encryptedKey) {
        try {
          const rawKey = decrypt(encryptedKey);
          refreshed.ai_settings.openai_api_key_masked = maskApiKey(rawKey);
          refreshed.ai_settings.has_openai_key = true;
        } catch {
          refreshed.ai_settings.openai_api_key_masked = "••••••••";
          refreshed.ai_settings.has_openai_key = true;
        }
      } else {
        refreshed.ai_settings.openai_api_key_masked = "";
        refreshed.ai_settings.has_openai_key = false;
      }
      delete refreshed.ai_settings.openai_api_key;
    }

    return res.status(200).json({ message: "Settings updated successfully", data: refreshed });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

/**
 * Validate an OpenAI API key by making a lightweight test call.
 * Used during organization create/edit before saving.
 */
export const validateOpenAIKeyController = async (req, res) => {
  try {
    const { openai_api_key } = req.body;

    if (!openai_api_key || !openai_api_key.trim()) {
      return res.status(400).json({ message: "OpenAI API key is required" });
    }

    const trimmedKey = openai_api_key.trim();

    // Quick format check
    if (!trimmedKey.startsWith("sk-")) {
      return res.status(400).json({
        message: "Invalid key format. OpenAI keys start with 'sk-'",
      });
    }

    // Test the key with a minimal API call
    const testClient = new OpenAI({ apiKey: trimmedKey });
    await testClient.models.list();

    return res.status(200).json({
      message: "OpenAI API key is valid",
      valid: true,
    });
  } catch (err) {
    const status = err?.status || 500;
    if (status === 401) {
      return res.status(400).json({
        message: "Invalid OpenAI API key. Authentication failed.",
        valid: false,
      });
    }
    if (status === 429) {
      return res.status(400).json({
        message:
          "OpenAI API key is rate-limited or has exceeded quota. Please check your billing.",
        valid: false,
      });
    }
    return res.status(400).json({
      message: `OpenAI API key validation failed: ${err.message}`,
      valid: false,
    });
  }
};
