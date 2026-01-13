import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createWhatsappAccountService = async (
  tenant_id,
  whatsapp_number,
  phone_number_id,
  waba_id,
  access_token
) => {
  const Query = `
  INSERT INTO ${tableNames?.WHATSAPP_ACCOUNT} 
  (  tenant_id,
  whatsapp_number,
  phone_number_id,
  waba_id,
  access_token )

  VALUES (?,?,?,?,?) `;

  const values = [
    tenant_id,
    whatsapp_number,
    phone_number_id,
    waba_id,
    access_token,
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
    return result;
  } catch (err) {
    throw err;
  }
};
