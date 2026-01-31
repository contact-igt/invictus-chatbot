import bcrypt from "bcrypt";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const registerManagementService = async (
  management_id,
  title,
  username,
  email,
  country_code,
  mobile,
  password,
  role,
) => {
  const password_hash = await bcrypt.hash(password, 10);

  const Query = `
    INSERT INTO ${tableNames.MANAGEMENT}
    (management_id, title, username, email, country_code, mobile, password, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    management_id,
    title,
    username,
    email,
    country_code,
    mobile,
    password_hash,
    role,
  ];

  const [result] = await db.sequelize.query(Query, { replacements: values });
  return result;
};

export const loginManagementService = async (email) => {
  try {
    const Query = `
    SELECT * FROM ${tableNames.MANAGEMENT}
    WHERE email = ? AND is_deleted = false
  `;

    const [result] = await db.sequelize.query(Query, {
      replacements: [email],
    });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getAllManagementService = async () => {
  try {
    const Query = `
    SELECT * FROM ${tableNames.MANAGEMENT} WHERE is_deleted IN(?)
    ORDER BY created_at DESC
  `;

    const [result] = await db.sequelize.query(Query, { replacements: [0] });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getAllManagementAdminService = async (role) => {
  try {
    const Query = `
    SELECT * FROM ${tableNames.MANAGEMENT} WHERE role IN(?) AND is_deleted IN(?)
    ORDER BY created_at DESC
  `;

    const [result] = await db.sequelize.query(Query, {
      replacements: [role, 0],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getManagementByIdService = async (management_id) => {
  const Query = `
    SELECT * FROM ${tableNames.MANAGEMENT}
    WHERE management_id = ? AND is_deleted = ?
  `;

  const [result] = await db.sequelize.query(Query, {
    replacements: [management_id, 0],
  });

  return result[0];
};

export const updateManagementService = async (
  targetUserId,
  title,
  username,
  country_code,
  mobile,
  profile,
  role,
  status
) => {
  const updateValues = [];
  const uppdateFields = [];

  if (title) {
    uppdateFields.push(`title = ?`);
    updateValues.push(title);
  }

  if (username) {
    uppdateFields.push(`username = ?`);
    updateValues.push(username);
  }

  if (country_code) {
    uppdateFields.push(`country_code = ?`);
    updateValues.push(country_code);
  }

  if (mobile) {
    uppdateFields.push(`mobile = ?`);
    updateValues.push(mobile);
  }

  if (profile) {
    uppdateFields.push(`profile = ?`);
    updateValues.push(profile);
  }

  if (role) {
    uppdateFields.push(`role = ?`);
    updateValues.push(role);
  }

  if (status) {
    uppdateFields.push(`status = ?`);
    updateValues.push(status);
  }

  updateValues.push(targetUserId);
  updateValues.push(0);

  const Query = `UPDATE ${tableNames?.MANAGEMENT} SET ${uppdateFields.join(", ")} WHERE management_id = ? AND is_deleted = ? `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: updateValues,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateDeleteStatusByIdService = async (management_id) => {
  const Query = `UPDATE ${tableNames?.MANAGEMENT} SET is_deleted = ? , deleted_at = NOW() WHERE management_id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [true, management_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteManagmentByIdService = async (management_id) => {
  const Query = `DELETE FROM ${tableNames?.MANAGEMENT}  WHERE management_id = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [management_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const updateManagementPasswordService = async (management_id, password_hash) => {
  const Query = `UPDATE ${tableNames.MANAGEMENT} SET password = ? WHERE management_id = ? AND is_deleted = false`;
  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [password_hash, management_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};
