import axios from "axios";
import {
  createOrUpdateWhatsappAccountService,
  getWhatsappAccountByTenantService,
  updateWhatsappAccountStatusService,
  updateAccessTokenService,
  softDeleteWhatsappAccountService,
  permanentDeleteWhatsappAccountService,
  syncWabaMetaInfoService,
  subscribeToWebhookFieldsService,
  validateMetaSubscriptionService,
} from "./whatsappAccount.service.js";
import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";

export const whatsappOAuthCallbackController = async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).send({ message: "Invalid OAuth callback" });
    }

    // decode tenant_id from state
    const decodedState = JSON.parse(
      Buffer.from(state, "base64").toString("utf8"),
    );

    const tenant_id = decodedState.tenant_id;

    if (!tenant_id) {
      return res.status(400).send({ message: "Tenant context missing" });
    }

    // 1️⃣ Exchange code → access token
    const tokenRes = await axios.get(
      "https://graph.facebook.com/v19.0/oauth/access_token",
      {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: process.env.META_REDIRECT_URI,
          code,
        },
      },
    );

    const access_token = tokenRes.data.access_token;

    // 2️⃣ Get business
    const businessRes = await axios.get(
      "https://graph.facebook.com/v19.0/me/businesses",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );

    const business = businessRes.data?.data?.[0];
    if (!business) throw new Error("No Facebook Business found");

    // 3️⃣ Get WABA
    const wabaRes = await axios.get(
      `https://graph.facebook.com/v19.0/${business.id}/owned_whatsapp_business_accounts`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );

    const waba = wabaRes.data?.data?.[0];
    if (!waba) throw new Error("No WhatsApp Business Account found");

    // 4️⃣ Get phone number
    const phoneRes = await axios.get(
      `https://graph.facebook.com/v19.0/${waba.id}/phone_numbers`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
      },
    );

    const phone = phoneRes.data?.data?.[0];
    if (!phone) throw new Error("No WhatsApp phone number found");

    await createOrUpdateWhatsappAccountService(
      tenant_id,
      phone.display_phone_number,
      phone.id,
      waba.id,
      access_token,
    );

    return res.redirect(
      `${process.env.FRONTEND_URL}/settings/whatsapp?status=connected`,
    );
  } catch (err) {
    return res.status(500).send({
      message: "WhatsApp OAuth connection failed",
      error: err.response?.data || err.message,
    });
  }
};

export const manualConnectWhatsappController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const { whatsapp_number, phone_number_id, waba_id, access_token } =
      req.body;

    if (!tenant_id) {
      return res.status(400).send({ message: "Invalid tenant context" });
    }

    const requiredFields = {
      whatsapp_number,
      phone_number_id,
      waba_id,
      access_token,
    };

    const missingFields = await missingFieldsChecker(requiredFields);
    if (missingFields.length > 0) {
      return res.status(400).send({
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    await createOrUpdateWhatsappAccountService(
      tenant_id,
      whatsapp_number,
      phone_number_id,
      waba_id,
      access_token,
    );

    return res.status(200).send({
      message: "WhatsApp details saved. Please test connection.",
    });
  } catch (err) {
    return res.status(500).send({
      message: err.message,
    });
  }
};

export const testWhatsappAccountController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  const account = await getWhatsappAccountByTenantService(tenant_id);

  if (!account) {
    return res.status(404).send({ message: "WhatsApp account not found" });
  }

  try {
    await axios.get(
      `https://graph.facebook.com/v19.0/${account.phone_number_id}`,
      {
        headers: {
          Authorization: `Bearer ${account.access_token}`,
        },
      },
    );

    await updateWhatsappAccountStatusService(account.id, "verified", null);

    return res.status(200).send({
      message:
        "WhatsApp connection verified successfully! You can now activate your account.",
      status: "verified",
    });
  } catch (err) {
    const isNetworkError = err.code === "ENOTFOUND";

    const metaError =
      err.response?.data?.error?.message || err.response?.data || err.message;

    await updateWhatsappAccountStatusService(
      account.id,
      "failed",
      isNetworkError
        ? "Server cannot reach Meta (DNS/network issue)"
        : metaError,
    );

    return res.status(500).send({
      message: isNetworkError
        ? "Server network issue. Please contact support."
        : `WhatsApp verification failed: ${metaError}`,
    });
  }
};

// export const testWhatsappAccountConnectionController = async (req, res) => {
//   const tenant_id = req.user.tenant_id;

//   if (!tenant_id) {
//     return res.status(400).send({ message: "Invalid tenant context" });
//   }

//   const account = await getWhatsappAccountByIdService(tenant_id);

//   if (!account) {
//     return res.status(404).send({
//       message: "WhatsApp account not found",
//     });
//   }

//   try {
//     const response = await axios.get(
//       `https://graph.facebook.com/v19.0/${account?.phone_number_id}`,
//       {
//         headers: {
//           Authorization: `Bearer ${account?.access_token}`,
//         },
//       },
//     );

//     const metaWabaId = response.data?.whatsapp_business_account?.id;

//     if (account.waba_id && metaWabaId && metaWabaId !== account.waba_id) {
//       throw new Error("WABA ID does not match this phone number");
//     }

//     await updateWhatsappAccountStatusService(account.id, "verified", null);

//     return res.status(200).send({
//       message: "WhatsApp connection successful",
//       data: {
//         phone: response.data.display_phone_number,
//         business_name: response.data.verified_name,
//       },
//     });
//   } catch (err) {
//     await updateWhatsappAccountStatusService(
//       account.id,
//       "failed",
//       err.response?.data || err.message,
//     );

//     return res.status(400).send({
//       message: "WhatsApp connection failed",
//       error: err.response?.data || err.message,
//     });
//   }
// };

export const updateAccessTokenController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { access_token } = req.body;

    if (!access_token || access_token.length < 50) {
      return res
        .status(400)
        .send({ message: "A valid access token is required." });
    }

    const account = await getWhatsappAccountByTenantService(tenant_id);
    if (!account) {
      return res.status(404).send({ message: "WhatsApp account not found" });
    }

    await updateAccessTokenService(tenant_id, access_token);

    return res.status(200).send({
      message:
        "Access token updated successfully. Please test connection to verify.",
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const activateWhatsappAccountController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const account = await getWhatsappAccountByTenantService(tenant_id);

    if (!account) {
      return res.status(404).send({
        message: "WhatsApp account not found",
      });
    }

    let newStatus;
    let message;

    if (account.status === "active") {
      newStatus = "inactive";
      message = "WhatsApp account deactivated successfully";
    } else if (["verified", "inactive"].includes(account.status)) {
      newStatus = "active";
      message = "WhatsApp account activated successfully";
    } else if (account.status === "pending" || account.status === "failed") {
      return res.status(400).send({
        message:
          "Your WhatsApp account is not yet verified. Please perform the 'Test Connection' process before activating.",
        status: account.status,
      });
    } else {
      return res.status(400).send({
        message: `Unable to activate account. Current status: ${account.status}. Please check your connection.`,
        status: account.status,
      });
    }

    await updateWhatsappAccountStatusService(account.id, newStatus, null);

    // Sync quality & tier from Meta when account goes active
    if (newStatus === "active") {
      syncWabaMetaInfoService(tenant_id).catch((e) =>
        console.error("[WABA Sync] Post-activate sync failed:", e.message),
      );
    }

    return res.status(200).send({
      message: message,
      status: newStatus,
    });
  } catch (err) {
    return res.status(500).send({
      error: err.message,
    });
  }
};

export const getWhatsappAccountController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const account = await getWhatsappAccountByTenantService(tenant_id);

    if (!account) {
      return res.status(404).send({ message: "WhatsApp account not found" });
    }

    // Non-blocking: refresh quality & tier from Meta in background
    // so next dashboard load always has up-to-date values
    syncWabaMetaInfoService(tenant_id).catch((e) =>
      console.error("[WABA Sync] Background sync failed:", e.message),
    );

    return res.status(200).send({
      data: account,
    });
  } catch (err) {
    return res.status(500).send({
      error: err.message,
    });
  }
};

export const softDeleteWhatsappAccountController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    await softDeleteWhatsappAccountService(tenant_id);
    return res.status(200).send({
      message: "WhatsApp account disconnected successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const permanentDeleteWhatsappAccountController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    await permanentDeleteWhatsappAccountService(tenant_id);
    return res.status(200).send({
      message: "WhatsApp account database records permanently removed",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

/**
 * Subscribe app to webhook fields (messages, message_template_status_update)
 * This should be called after webhook verification to complete the setup
 */
export const subscribeToWebhooksController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  try {
    // Get WhatsApp account for this tenant
    const account = await getWhatsappAccountByTenantService(tenant_id);

    if (!account) {
      return res.status(400).send({
        success: false,
        message:
          "WhatsApp account not configured. Please set up your WhatsApp account first.",
      });
    }

    if (!account.waba_id || !account.access_token) {
      return res.status(400).send({
        success: false,
        message:
          "Missing WABA ID or Access Token. Please configure your WhatsApp account.",
      });
    }

    // Subscribe to webhook fields
    const subscriptionResult = await subscribeToWebhookFieldsService(
      account.waba_id,
      account.access_token,
    );

    if (!subscriptionResult.success) {
      return res.status(400).send({
        success: false,
        message:
          subscriptionResult.error || "Failed to subscribe to webhook fields",
      });
    }

    // Verify the subscription
    const verifyResult = await validateMetaSubscriptionService(
      account.waba_id,
      account.access_token,
    );

    return res.status(200).send({
      success: true,
      message:
        "Successfully subscribed to Meta webhook fields (messages, message_template_status_update)",
      subscription: verifyResult,
    });
  } catch (err) {
    console.error("Subscribe to webhooks error:", err);
    return res.status(500).send({
      success: false,
      message: err?.message || "Failed to subscribe to webhooks",
    });
  }
};
