import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createWhatsappAccountService = async (
  tenant_id,
  whatsapp_number,
  phone_number_id,
  waba_id,
  access_token,
  status
) => {
  const Query = `
  INSERT INTO ${tableNames?.WHATSAPP_ACCOUNT} 
  (  tenant_id,
  whatsapp_number,
  phone_number_id,
  waba_id,
  access_token,
  status
   )

  VALUES (?,?,?,?,?,?) `;

  const values = [
    tenant_id,
    whatsapp_number,
    phone_number_id,
    waba_id,
    access_token,
    status,
  ];
  try {
    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getWhatsappAccountByIdService = async (tenant_id) => {
  const Query = `
    SELECT * FROM ${tableNames?.WHATSAPP_ACCOUNT} WHERE tenant_id = ? `;

  const values = [tenant_id];
  try {
    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updateWhatsappAccountStatusService = async (id, status, error) => {
  
  const Query = `UPDATE ${tableNames?.WHATSAPP_ACCOUNT} SET status = ? , last_error = ? , is_verified = ? , verified_at = ? WHERE id = ? `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [
        status,
        error,
        status === "verified" ? "true" : "false",
        status === "verified" ? new Date() : null,
        id,
      ],
    });

    return result;
  } catch (err) {
    throw err;
  }
};
