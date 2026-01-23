import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createContactService = async (
  tenant_id,
  phone,
  name,
  profile_pic,
) => {
  const Query = `
  INSERT INTO ${tableNames?.CONTACTS} 
  (tenant_id, phone, name, profile_pic, last_message_at ) VALUES (?,?,?,?, NOW())`;

  try {
    const Values = [tenant_id, phone, name, profile_pic];

    const [result] = await db.sequelize.query(Query, { replacements: Values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getContactByPhoneAndTenantIdService = async (tenant_id, phone) => {
  try {
    const Values = [tenant_id, phone];

    const Query = `SELECT * FROM ${tableNames?.CONTACTS} WHERE tenant_id = ? AND phone = ? LIMIT 1 `;

    const [result] = await db.sequelize.query(Query, { replacements: Values });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getContactByIdAndTenantIdService = async (id, tenant_id) => {
  try {
    const Values = [id, tenant_id];

    const Query = `SELECT * FROM ${tableNames?.CONTACTS} WHERE id = ? AND tenant_id = ? LIMIT 1 `;

    const [result] = await db.sequelize.query(Query, { replacements: Values });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getAllContactsService = async (tenant_id) => {
  try {
    const Query = `SELECT * FROM ${tableNames?.CONTACTS} WHERE tenant_id IN (?) ORDER BY id DESC`;

    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};
