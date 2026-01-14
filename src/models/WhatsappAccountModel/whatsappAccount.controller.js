import axios from "axios";
import {
  createWhatsappAccountService,
  getWhatsappAccountByIdService,
  updateWhatsappAccountStatusService,
} from "./whatsappAccount.service.js";
import { missingFieldsChecker } from "../../utils/missingFields.js";

export const whatsappCallbackController = async (req, res) => {
  try {
    const { code } = req.query;

    const tenant_id = 1;

    if (!code) {
      return res.status(400).send({ message: "Authorization code missing" });
    }

    if (!tenant_id) {
      return res.status(400).send({ message: "Invalid tenant context" });
    }

    const tokenRes = await axios.get(
      "https://graph.facebook.com/v19.0/oauth/access_token",
      {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: process.env.META_REDIRECT_URI,
          code: code,
        },
      }
    );

    const access_token = tokenRes.data.access_token;

    if (!access_token) {
      return res.status(400).send({
        message: "Access token not received from Meta",
      });
    }

    const businessRes = await axios.get(
      "https://graph.facebook.com/v19.0/me/businesses",
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const business = businessRes.data?.data?.[0];

    if (!business) {
      return res.status(400).send({
        message: "No Facebook Business found for this user",
      });
    }

    const business_id = business.id;

    const wabaRes = await axios.get(
      `https://graph.facebook.com/v19.0/${business_id}/owned_whatsapp_business_accounts`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const waba = wabaRes.data?.data?.[0];

    if (!waba) {
      return res.status(400).send({
        message: "No WhatsApp Business Account found",
      });
    }

    const waba_id = waba.id;

    const phoneRes = await axios.get(
      `https://graph.facebook.com/v19.0/${waba_id}/phone_numbers`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const phone = phoneRes.data?.data?.[0];

    if (!phone) {
      return res.status(400).send({
        message: "No WhatsApp phone number found",
      });
    }

    const phone_number_id = phone.id;
    const whatsapp_number = phone.display_phone_number;

    await createWhatsappAccountService(
      tenant_id,
      whatsapp_number,
      phone_number_id,
      waba_id,
      access_token
    );

    return res.redirect(
      "http://localhost:3000/settings/whatsapp-settings?status=connected"
    );
  } catch (err) {
    console.error("META ERROR:", err.response?.data || err.message);

    return res.status(500).send({
      message: "WhatsApp connection failed",
      meta_error: err.response?.data || err.message,
    });
  }
};

// ---------------------

export const createWhatsappAccountController = async (req, res) => {
  const { whatsapp_number, phone_number_id, waba_id, access_token } = req.body;

  const tenant_id = req.user.tenant_id;

  const requiredFields = {
    tenant_id,
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

  try {
    await createWhatsappAccountService(
      tenant_id,
      whatsapp_number,
      phone_number_id,
      waba_id,
      access_token,
      "pending"
    );

    return res.status(200).send({
      message: "WhatsApp details saved. Please test connection.",
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res.status(400).send({
        message: "Tenant or whatsapp number or phone number id already exists",
      });
    }

    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const testWhatsappAccountConnectionController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  const account = await getWhatsappAccountByIdService(tenant_id);

  if (!account) {
    return res.status(404).send({
      message: "WhatsApp account not found",
    });
  }

  try {
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${account?.phone_number_id}`,
      {
        headers: {
          Authorization: `Bearer ${account?.access_token}`,
        },
      }
    );

    const metaWabaId = response.data?.whatsapp_business_account?.id;

    if (account.waba_id && metaWabaId && metaWabaId !== account.waba_id) {
      throw new Error("WABA ID does not match this phone number");
    }

    await updateWhatsappAccountStatusService(account.id, "verified", null);

    return res.status(200).send({
      message: "WhatsApp connection successful",
      data: {
        phone: response.data.display_phone_number,
        business_name: response.data.verified_name,
      },
    });
  } catch (err) {
    await updateWhatsappAccountStatusService(
      account.id,
      "failed",
      err.response?.data || err.message
    );

    return res.status(400).send({
      message: "WhatsApp connection failed",
      error: err.response?.data || err.message,
    });
  }
};

export const getWhatsappAccountByIdController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  if (!tenant_id) {
    return res.status(400).send({ message: "Invalid tenant context" });
  }

  try {
    const response = await getWhatsappAccountByIdService(tenant_id);

    return res.status(200).send({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};

export const activateWhatsappAccountController = async (req, res) => {
  const tenant_id = req.user.tenant_id;

  const { status } = req.params;

  try {
    if (!status) {
      return res.status(400).send({
        message: "Status required",
      });
    }

    const account = await getWhatsappAccountByIdService(tenant_id);

    if (!account || account.status !== "verified") {
      return res.status(400).send({
        message: "Please test connection before activation",
      });
    }

    await updateWhatsappAccountStatusService(account.id, status, null);

    return res.status(200).send({
      message: "WhatsApp account activated successfully",
    });
  } catch (err) {
    return res.status(500).send({
      message: err?.message,
    });
  }
};
