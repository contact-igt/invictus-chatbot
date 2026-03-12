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
const TIER_LABEL_MAP = {
    TIER_NOT_SET: "TRIAL",
    TIER_50:      "1K MSG LIMIT",
    TIER_250:     "10K MSG LIMIT",
    TIER_1K:      "100K MSG LIMIT",
    TIER_10K:     "UNLIMITED",
    TIER_100K:    "UNLIMITED"
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
            raw: true
        });

        if (!account || !account.phone_number_id || !account.access_token) {
            throw new Error("No active WhatsApp account found for this tenant.");
        }

        // 2. Call Meta Graph API
        const metaResponse = await axios.get(
            `https://graph.facebook.com/v19.0/${account.phone_number_id}`,
            {
                params: {
                    fields: "display_phone_number,quality_rating,messaging_limit_tier,code_verification_status",
                    access_token: account.access_token
                },
                timeout: 8000
            }
        );

        const { quality_rating, messaging_limit_tier } = metaResponse.data;

        // 3. Map Meta values to DB-friendly values
        const qualityForDb = ["GREEN", "YELLOW", "RED"].includes(quality_rating)
            ? quality_rating
            : "GREEN";

        const tierLabel = TIER_LABEL_MAP[messaging_limit_tier] || messaging_limit_tier || "1K MSG LIMIT";

        // 4. Update the WhatsappAccount row
        await db.Whatsappaccount.update(
            { quality: qualityForDb, tier: tierLabel },
            { where: { id: account.id } }
        );

        return {
            quality: qualityForDb,
            tier: tierLabel,
            raw_tier: messaging_limit_tier
        };

    } catch (err) {
        // Non-blocking: log but don't crash — dashboard still works with DB fallback values
        console.error("[WABA Sync] Meta API sync failed:", err?.response?.data || err.message);
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
    const [result] = await db.sequelize.query(Query, { replacements: [tenant_id] });
    return result;
  } catch (err) {
    throw err;
  }
};

export const permanentDeleteWhatsappAccountService = async (tenant_id) => {
  const Query = `DELETE FROM ${tableNames.WHATSAPP_ACCOUNT} WHERE tenant_id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, { replacements: [tenant_id] });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getTenantByPhoneNumberIdService = async (phone_number_id) => {
  const Query = `SELECT * FROM ${tableNames?.WHATSAPP_ACCOUNT} WHERE phone_number_id = ? AND status = 'active' AND is_deleted = false LIMIT 1 `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [phone_number_id],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};
