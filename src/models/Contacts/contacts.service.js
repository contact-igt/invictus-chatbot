import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createContactService = async (phone) => {
  const Query = `INSERT INTO ${tableNames?.CONTACTS} (phone) VALUES (?)`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [phone],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateContactService = async (phone, field, value) => {
  const Query = `UPDATE ${tableNames?.CONTACTS} SET ${field} = ? WHERE phone = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [value, phone],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getcontactByPhoneService = async (phone) => {
  const Query = `SELECT * FROM ${tableNames?.CONTACTS} WHERE phone = ? `;

  try {
    const [result] = await db.sequelize.query(Query, { replacements: [phone] });

    return result;
  } catch (err) {
    throw err;
  }
};

export const addContactDetailService = async (phone, field, value) => {
  const getphonelist = await getcontactByPhoneService(phone);

  if (getphonelist?.length > 0) {
    await updateContactService(phone, field, value);
  } else {
    await createContactService(phone);
    await updateContactService(phone, field, value);
  }
};
