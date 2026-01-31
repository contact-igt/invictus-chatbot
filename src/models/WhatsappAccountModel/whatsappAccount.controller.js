import axios from "axios";
import {
  createOrUpdateWhatsappAccountService,
  getWhatsappAccountByTenantService,
  updateWhatsappAccountStatusService,
} from "./whatsappAccount.service.js";
import { missingFieldsChecker } from "../../utils/missingFields.js";

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
      message: "WhatsApp connection verified successfully",
    });
  } catch (err) {
    const isNetworkError = err.code === "ENOTFOUND";

    await updateWhatsappAccountStatusService(
      account.id,
      "failed",
      isNetworkError
        ? "Server cannot reach Meta (DNS/network issue)"
        : err.response?.data || err.message,
    );

    return res.status(500).send({
      message: isNetworkError
        ? "Server network issue. Please contact support."
        : "WhatsApp verification failed",
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

export const activateWhatsappAccountController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const account = await getWhatsappAccountByTenantService(tenant_id);

    if (!account || account.status !== "verified") {
      return res.status(400).send({
        message: "WhatsApp account must be verified before activation",
      });
    }

    await updateWhatsappAccountStatusService(account.id, "active", null);

    return res.status(200).send({
      message: "WhatsApp account activated successfully",
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

    return res.status(200).send({
      data: account,
    });
  } catch (err) {
    return res.status(500).send({
      error: err.message,
    });
  }
};
