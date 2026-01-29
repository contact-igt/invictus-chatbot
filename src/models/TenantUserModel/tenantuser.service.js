import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createTenantUserService = async (
  tenant_user_id,
  tenant_id,
  name,
  email,
  country_code,
  mobile,
  profile,
  role,
) => {
  const query = `
    INSERT INTO ${tableNames.TENANT_USERS}
    (
  tenant_user_id,
  tenant_id,
  name,
  email,
  country_code,
  mobile,
  profile,
  role  )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    tenant_user_id,
    tenant_id,
    name,
    email,
    country_code,
    mobile,
    profile,
    role,
  ];

  try {
    const [result] = await db.sequelize.query(query, {
      replacements: values,
    });

    return result;
  } catch (error) {
    throw error;
  }
};

export const loginTenantUserService = async (email) => {
  try {
    const Query = `
    SELECT * FROM ${tableNames.TENANT_USERS}
    WHERE email = ? AND is_deleted = ?
  `;

    const [result] = await db.sequelize.query(Query, {
      replacements: [email, 0],
    });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const findTenantUserByIdService = async (tenant_user_id) => {
  const Query = `SELECT * FROM ${tableNames?.TENANT_USERS} WHERE tenant_user_id = ? AND is_deleted = false LIMIT 1`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_user_id],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const activateTenantUserService = async (tenant_user_id) => {
  const Query = `UPDATE ${tableNames?.TENANT_USERS} SET status = ? WHERE tenant_user_id = ? AND is_deleted = ?`;

  try {
    const values = ["active", tenant_user_id, 0];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateTenantUserPasswordService = async (
  password_hash,
  tenant_user_id,
) => {
  const Query = `UPDATE ${tableNames?.TENANT_USERS} SET password_hash = ? WHERE tenant_user_id = ? AND is_deleted = ?`;

  try {
    const values = [password_hash, tenant_user_id, 0];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result;
  } catch (err) {
    throw err;
  }
};

// ----------------------

export const updateTenantUserService = async (name, email, email_at) => {
  const updateFields = [];
  const updateValues = [];

  if (name) {
    updateFields.push("name = ?");
    updateValues.push(name);
  }

  if (email) {
    updateFields.push("email = ?");
    updateValues.push(email);
  }

  updateValues.push(email_at);
  updateValues.push(0);

  const Query = `
    UPDATE ${tableNames?.TENANT_USERS}
    SET ${updateFields.join(", ")}
    WHERE email = ? AND is_deleted = ?
  `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: updateValues,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const getAllTenantUsersService = async (tenant_id) => {
  try {
    const query = `
    SELECT
      tenant_user_id,
      name,
      email,
      role,
      status,
      created_at
    FROM ${tableNames.TENANT_USERS}
    WHERE tenant_id = ?
      AND is_deleted = false
    ORDER BY created_at DESC
  `;

    const [rows] = await db.sequelize.query(query, {
      replacements: [tenant_id],
    });

    return rows;
  } catch (err) {
    throw err;
  }
};

export const updateTenantUserByIdService = async (tenant_user_id, data) => {
  const fields = [];
  const values = [];

  try {
    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    });

    if (!fields.length) return;

    values.push(tenant_user_id);

    const query = `
    UPDATE ${tableNames.TENANT_USERS}
    SET ${fields.join(", ")}, updated_at = NOW()
    WHERE tenant_user_id = ?
      AND is_deleted = false
  `;

    await db.sequelize.query(query, {
      replacements: values,
    });
  } catch (err) {
    throw err;
  }
};

export const softDeleteTenantUserService = async (tenant_user_id) => {
  const query = `
    UPDATE ${tableNames.TENANT_USERS}
    SET is_deleted = true,
        deleted_at = NOW()
    WHERE tenant_user_id = ?
      AND is_deleted = false
  `;

  await db.sequelize.query(query, {
    replacements: [tenant_user_id],
  });
};

export const permanentDeleteTenantUserService = async (tenant_user_id) => {
  const query = `
    DELETE FROM ${tableNames.TENANT_USERS}
    WHERE tenant_user_id = ?
  `;

  await db.sequelize.query(query, {
    replacements: [tenant_user_id],
  });
};
