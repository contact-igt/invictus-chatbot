import axios from "axios";
import {
  createWhatsappAccountService,
  getWhatsappAccountByIdService,
} from "./whatsappAccount.service.js";

export const whatsappCallbackController = async (req, res) => {
  try {
    const { code } = req.query;
    const user = req.user;
    const tenant_id = user.tenant_id;

    if (!code) {
      return res.status(400).json({ message: "Authorization code missing" });
    }

    if (!tenant_id) {
      return res.status(400).json({ message: "Invalid tenant context" });
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
      return res.status(400).json({
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
      return res.status(400).json({
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
      return res.status(400).json({
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
      return res.status(400).json({
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
      ` ${process.env.FRONTEND_URL}/settings/whatsapp-settings?status=connected `
    );
  } catch (err) {
    console.error("META ERROR:", err.response?.data || err.message);

    return res.status(500).json({
      message: "WhatsApp connection failed",
      meta_error: err.response?.data || err.message,
    });
  }
};

export const getWhatsappAccountByIdController = async (req, res) => {
  const user = req.user;
  const tenant_id = user.tenant_id;

  if (!tenant_id) {
    return res.status(400).json({ message: "Invalid tenant context" });
  }

  try {
    const response = await getWhatsappAccountByIdService(tenant_id);

    return res.status(200).json({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).json({
      message: err?.message,
    });
  }
};
