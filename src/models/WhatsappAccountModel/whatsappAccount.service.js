// import db from "../../database/index.js";
// import { tableNames } from "../../database/tableName.js";

// export const createWhatsappAccountService = async (
//   tenant_id,
//   whatsapp_number,
//   phone_number_id,
//   waba_id,
//   access_token,
//   status,
// ) => {
//   const Query = `
//   INSERT INTO ${tableNames?.WHATSAPP_ACCOUNT}
//   (  tenant_id,
//   whatsapp_number,
//   phone_number_id,
//   waba_id,
//   access_token,
//   status
//    )

//   VALUES (?,?,?,?,?,?) `;

//   const values = [
//     tenant_id,
//     whatsapp_number,
//     phone_number_id,
//     waba_id,
//     access_token,
//     status,
//   ];
//   try {
//     const [result] = await db.sequelize.query(Query, { replacements: values });
//     return result;
//   } catch (err) {
//     throw err;
//   }
// };

// export const getWhatsappAccountByIdService = async (tenant_id) => {
//   const Query = `
//     SELECT * FROM ${tableNames?.WHATSAPP_ACCOUNT} WHERE tenant_id = ? `;

//   const values = [tenant_id];
//   try {
//     const [result] = await db.sequelize.query(Query, { replacements: values });
//     return result[0];
//   } catch (err) {
//     throw err;
//   }
// };

// export const updateWhatsappAccountStatusService = async (id, status, error) => {
//   const Query = `UPDATE ${tableNames?.WHATSAPP_ACCOUNT} SET status = ? , last_error = ? , is_verified = ? , verified_at = ? WHERE id = ? `;

//   try {
//     const [result] = await db.sequelize.query(Query, {
//       replacements: [
//         status,
//         error,
//         status === "verified" ? "true" : "false",
//         status === "verified" ? new Date() : null,
//         id,
//       ],
//     });

//     return result;
//   } catch (err) {
//     throw err;
//   }
// };

import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import axios from "axios";

/**
 * Tier label map: Meta messaging_limit_tier → human-readable UI label
 */
export const META_TIER_CONFIG = {
  TIER_NOT_SET: {
    name: "Trial",
    limit: 250,
  },
  TIER_50: {
    name: "Tier 1",
    limit: 1000,
  },
  TIER_250: {
    name: "Tier 2",
    limit: 10000,
  },
  TIER_1K: {
    name: "Tier 3",
    limit: 100000,
  },
  TIER_10K: {
    name: "Tier 4",
    limit: "Unlimited",
  },
  TIER_100K: {
    name: "Tier 4",
    limit: "Unlimited",
  },
};

/**
 * Calls Meta Graph API to fetch quality_rating and messaging_limit_tier
 * for the tenant's WhatsApp phone number, then saves them to the DB.
 *
 * Meta API:
 *   GET https://graph.facebook.com/v19.0/{phone_number_id}
 *       ?fields=display_phone_number,quality_rating,messaging_limit_tier
 *       &access_token={access_token}
 *
 * Call this:
 *   - When a tenant activates their WABA (already done in activate controller)
 *   - On GET /whatsapp-account (to refresh on page load)
 *   - Via a scheduled cron (e.g., every 6 hours)
 */
export const syncWabaMetaInfoService = async (tenant_id) => {
  try {
    // 1. Fetch phone_number_id and access_token from DB
    const account = await db.Whatsappaccount.findOne({
      where: { tenant_id, is_deleted: false },
      attributes: ["id", "phone_number_id", "access_token"],
      raw: true,
    });

    if (!account || !account.phone_number_id || !account.access_token) {
      throw new Error("No active WhatsApp account found for this tenant.");
    }

    // 2. Call Meta Graph API
    const metaResponse = await axios.get(
      `https://graph.facebook.com/v19.0/${account.phone_number_id}`,
      {
        params: {
          fields:
            "display_phone_number,quality_rating,messaging_limit_tier,code_verification_status",
          access_token: account.access_token,
        },
        timeout: 8000,
      },
    );

    const { quality_rating, messaging_limit_tier } = metaResponse.data;

    // 3. Map Meta values to DB-friendly values
    const qualityForDb = ["GREEN", "YELLOW", "RED"].includes(quality_rating)
      ? quality_rating
      : "GREEN";

    const tierRaw = messaging_limit_tier || "TIER_NOT_SET";
    console.log("tierRaw", tierRaw);
    const tierLabel = META_TIER_CONFIG[tierRaw] ? tierRaw : "TIER_NOT_SET";
    console.log("tierLabel", tierLabel);

    // 4. Update the WhatsappAccount row
    await db.Whatsappaccount.update(
      { quality: qualityForDb, tier: tierLabel },
      { where: { id: account.id } },
    );

    return {
      quality: qualityForDb,
      tier: tierLabel,
      raw_tier: messaging_limit_tier,
    };
  } catch (err) {
    // Non-blocking: log but don't crash — dashboard still works with DB fallback values
    console.error(
      "[WABA Sync] Meta API sync failed:",
      err?.response?.data || err.message,
    );
    return null;
  }
};

export const createOrUpdateWhatsappAccountService = async (
  tenant_id,
  whatsapp_number,
  phone_number_id,
  waba_id,
  access_token,
) => {
  try {
    // 1️⃣ Check if this exact account (whatsapp_number or phone_number_id) is already registered by ANY tenant
    const [existingAccounts] = await db.sequelize.query(
      `SELECT tenant_id, whatsapp_number, phone_number_id FROM ${tableNames.WHATSAPP_ACCOUNT} 
       WHERE (whatsapp_number = ? OR phone_number_id = ?) AND is_deleted = false LIMIT 1`,
      { replacements: [whatsapp_number, phone_number_id] },
    );

    if (existingAccounts.length > 0) {
      const existing = existingAccounts[0];

      if (existing.tenant_id === tenant_id) {
        throw new Error(
          "This WhatsApp account is already linked to your profile.",
        );
      } else {
        throw new Error(
          "This WhatsApp number or Phone ID is already registered by another user.",
        );
      }
    }

    // 2️⃣ If no duplicates, proceed with Insert or Update
    const Query = `
    INSERT INTO ${tableNames.WHATSAPP_ACCOUNT}
    (tenant_id, whatsapp_number, phone_number_id, waba_id, access_token, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
    ON DUPLICATE KEY UPDATE
      whatsapp_number = VALUES(whatsapp_number),
      phone_number_id = VALUES(phone_number_id),
      waba_id = VALUES(waba_id),
      access_token = VALUES(access_token),
      status = 'pending',
      last_error = NULL
  `;

    await db.sequelize.query(Query, {
      replacements: [
        tenant_id,
        whatsapp_number,
        phone_number_id,
        waba_id,
        access_token,
      ],
    });
  } catch (err) {
    throw err;
  }
};

export const getWhatsappAccountByTenantService = async (tenant_id) => {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.WHATSAPP_ACCOUNT} WHERE tenant_id = ? AND is_deleted = false LIMIT 1`,
      { replacements: [tenant_id] },
    );
    return rows[0];
  } catch (err) {
    throw err;
  }
};

export const updateWhatsappAccountStatusService = async (id, status, error) => {
  try {
    const formattedError =
      typeof error === "object" ? JSON.stringify(error) : error;

    await db.sequelize.query(
      `
    UPDATE ${tableNames.WHATSAPP_ACCOUNT}
    SET status = ?, last_error = ?, is_verified = ?, verified_at = ?
    WHERE id = ?
  `,
      {
        replacements: [
          status,
          formattedError,
          status === "verified",
          status === "verified" ? new Date() : null,
          id,
        ],
      },
    );
  } catch (err) {
    throw err;
  }
};

export const softDeleteWhatsappAccountService = async (tenant_id) => {
  const Query = `UPDATE ${tableNames.WHATSAPP_ACCOUNT} SET is_deleted = true, deleted_at = NOW(), status = 'inactive' WHERE tenant_id = ? AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const permanentDeleteWhatsappAccountService = async (tenant_id) => {
  const Query = `DELETE FROM ${tableNames.WHATSAPP_ACCOUNT} WHERE tenant_id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateAccessTokenService = async (tenant_id, access_token) => {
  try {
    const [result] = await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_ACCOUNT} SET access_token = ?, status = 'pending', last_error = NULL WHERE tenant_id = ? AND is_deleted = false`,
      { replacements: [access_token, tenant_id] },
    );
    return result;
  } catch (err) {
    throw err;
  }
};

export const getTenantByPhoneNumberIdService = async (phone_number_id) => {
  const Query = `SELECT * FROM ${tableNames?.WHATSAPP_ACCOUNT} WHERE phone_number_id = ? AND status IN ('active', 'verified') AND is_deleted = false LIMIT 1 `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [phone_number_id],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

/**
 * Validates if Meta Graph API access_token is still valid
 * by calling GET /me endpoint
 */
export const validateAccessTokenService = async (access_token) => {
  try {
    const response = await axios.get("https://graph.facebook.com/v19.0/me", {
      params: { access_token },
      timeout: 8000,
    });
    return {
      valid: true,
      app_id: response.data?.id,
      name: response.data?.name,
    };
  } catch (err) {
    return {
      valid: false,
      error: err?.response?.data?.error?.message || err.message,
    };
  }
};

/**
 * Checks if app is subscribed to webhooks for the WABA
 * Meta API: GET /{waba_id}/subscribed_apps
 *
 * NOTE: This API only tells us IF an app is subscribed to the WABA,
 * not which specific webhook fields are subscribed. The field subscriptions
 * (messages, message_template_status_update, etc.) are configured in
 * Meta's App Dashboard and aren't returned by this API.
 *
 * If webhook_verified is true, Meta has already validated the webhook setup.
 */
export const validateMetaSubscriptionService = async (
  waba_id,
  access_token,
) => {
  try {
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${waba_id}/subscribed_apps`,
      {
        params: { access_token },
        timeout: 8000,
      },
    );

    const apps = response.data?.data || [];
    if (apps.length === 0) {
      return {
        subscribed: false,
        message: "No apps subscribed to this WhatsApp Business Account",
      };
    }

    // App is subscribed to this WABA - webhook fields are configured in Meta Dashboard
    // We can't verify specific fields via API, but if webhook_verified is true, setup is working
    const appSub = apps[0];

    return {
      subscribed: true,
      app_id: appSub?.id,
      app_name: appSub?.whatsapp_business_api_data?.name || appSub?.name,
      // Note: Field subscriptions are configured in Meta Dashboard, not retrievable via this API
      note: "Webhook field subscriptions are managed in Meta App Dashboard",
    };
  } catch (err) {
    return {
      subscribed: false,
      error: err?.response?.data?.error?.message || err.message,
    };
  }
};

/**
 * Gets comprehensive webhook and WhatsApp configuration status for a tenant
 * Returns detailed status for all verification components
 */
export const getComprehensiveWebhookStatusService = async (tenant_id) => {
  try {
    // 1. Get tenant info (verify_token, webhook_verified)
    const [tenantRows] = await db.sequelize.query(
      `SELECT tenant_id, company_name, verify_token, webhook_verified FROM ${tableNames.TENANTS} WHERE tenant_id = ? AND is_deleted = false LIMIT 1`,
      { replacements: [tenant_id] },
    );
    const tenant = tenantRows[0];

    if (!tenant) {
      return {
        overall_status: "error",
        error: "Tenant not found",
      };
    }

    // 2. Get WhatsApp account configuration
    const account = await getWhatsappAccountByTenantService(tenant_id);

    const result = {
      tenant_id,
      company_name: tenant.company_name,

      // Webhook verification status
      verify_token_set: !!tenant.verify_token,
      webhook_verified: !!tenant.webhook_verified,

      // WhatsApp account configuration
      whatsapp_configured: !!account,
      phone_number_id: account?.phone_number_id || null,
      waba_id: account?.waba_id || null,
      whatsapp_number: account?.whatsapp_number || null,
      account_status: account?.status || null,
      quality: account?.quality || null,
      tier: account?.tier || null,

      // Meta API validations (will be populated if account exists)
      access_token_valid: null,
      meta_subscription_active: null,
      subscription_details: null,

      // Overall status
      overall_status: "not_configured",
      issues: [],
    };

    // 3. If no WhatsApp account, return early
    if (!account || !account.access_token) {
      result.issues.push("WhatsApp account not configured");
      result.overall_status = "not_configured";
      return result;
    }

    // 4. Validate access token
    const tokenValidation = await validateAccessTokenService(
      account.access_token,
    );
    result.access_token_valid = tokenValidation.valid;
    if (!tokenValidation.valid) {
      result.issues.push(`Access token invalid: ${tokenValidation.error}`);
    }

    // 5. Validate Meta subscription (if waba_id exists)
    if (account.waba_id && tokenValidation.valid) {
      const subscriptionValidation = await validateMetaSubscriptionService(
        account.waba_id,
        account.access_token,
      );
      // App being subscribed to WABA is sufficient - field subscriptions are in Meta Dashboard
      result.meta_subscription_active = subscriptionValidation.subscribed;
      result.subscription_details = subscriptionValidation;

      if (!subscriptionValidation.subscribed) {
        result.issues.push("App not subscribed to WhatsApp webhooks");
      }
    }

    // 6. Determine overall status
    // Priority: webhook_verified is the real proof that Meta can reach our webhook
    const allChecks = [
      result.verify_token_set,
      result.webhook_verified,
      result.whatsapp_configured,
      result.access_token_valid,
      result.meta_subscription_active,
    ];

    const passedChecks = allChecks.filter((v) => v === true).length;

    // If webhook is verified and token is valid, system is ready
    if (
      result.webhook_verified &&
      result.access_token_valid &&
      result.whatsapp_configured
    ) {
      result.overall_status = "ready";
      result.issues = []; // Clear issues if everything essential works
    } else if (passedChecks >= 3) {
      result.overall_status = "partial";
    } else {
      result.overall_status = "not_configured";
    }

    return result;
  } catch (err) {
    console.error("[WebhookStatus] Error:", err);
    return {
      overall_status: "error",
      error: err.message,
    };
  }
};
