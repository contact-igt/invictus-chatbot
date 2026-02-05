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

export const createOrUpdateWhatsappAccountService = async (
  tenant_id,
  whatsapp_number,
  phone_number_id,
  waba_id,
  access_token,
) => {
  try {
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
    await db.sequelize.query(
      `
    UPDATE ${tableNames.WHATSAPP_ACCOUNT}
    SET status = ?, last_error = ?, is_verified = ?, verified_at = ?
    WHERE id = ?
  `,
      {
        replacements: [
          status,
          error,
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
