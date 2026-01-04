import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createAppSettingService = async (label, keyname, description) => {
  const Query = `INSERT INTO ${tableNames?.APPSETTINGS} ( label , setting_key , description) VALUES (?,?,?)`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [label, keyname, description],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateAppSettingService = async (
  setting_value,
  label,
  description,
  id
) => {
  const updateValues = [];
  const updateFields = [];

  if (setting_value) {
    updateFields.push(`setting_value = ?`);
    updateValues.push(setting_value);
  }

  if (label) {
    updateFields.push(`label = ?`);
    updateValues.push(label);
  }

  if (description) {
    updateFields.push(`description = ?`);
    updateValues.push(description);
  }

  updateValues.push(id);

  const Query = `UPDATE ${tableNames?.APPSETTINGS} SET ${updateFields.join(
    ", "
  )} WHERE id = ? `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: updateValues,
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const toggelAppSettingService = async (setting_value, id) => {
  const Query = `UPDATE ${tableNames?.APPSETTINGS} SET setting_value = ? WHERE id  = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [setting_value, id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getAllAppSettingService = async () => {
  const Query = `SELECT id , label , setting_value , description , created_at FROM ${tableNames?.APPSETTINGS}`;

  try {
    const [result] = await db.sequelize.query(Query);
    return result;
  } catch (err) {
    throw err;
  }
};

export const getAppSettingByIdService = async (id) => {
  const Query = `SELECT id , label , setting_value , description , created_at  FROM ${tableNames?.APPSETTINGS} WHERE id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, { replacements: [id] });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getAppSettingByKeyService = async (setting_key) => {
  const Query = `SELECT setting_value FROM ${tableNames?.APPSETTINGS} WHERE setting_key = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [setting_key],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};
