import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createTenantUserService = async (
  tenant_user_id,
  tenant_id,
  title,
  username,
  email,
  country_code,
  mobile,
  profile,
  role,
  password_hash,
  status = "inactive",
  transaction = null
) => {
  const query = `
    INSERT INTO ${tableNames.TENANT_USERS}
    (
  tenant_user_id,
  tenant_id,
  title,
  username,
  email,
  country_code,
  mobile,
  profile,
  role,
  password_hash,
  status  )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    tenant_user_id,
    tenant_id,
    title,
    username,
    email,
    country_code,
    mobile,
    profile,
    role,
    password_hash,
    status,
  ];

  try {
    const [result] = await db.sequelize.query(query, {
      replacements: values,
      transaction,
    });

    return result;
  } catch (error) {
    throw error;
  }
};

export const findTenantUserByEmailGloballyService = async (email) => {
  try {
    const query = `SELECT * FROM ${tableNames.TENANT_USERS} WHERE email = ? AND is_deleted = false LIMIT 1`;
    const rows = await db.sequelize.query(query, {
      replacements: [email],
      type: db.Sequelize.QueryTypes.SELECT,
    });
    return rows[0];
  } catch (err) {
    throw err;
  }
};

export const findTenantUserByEmailOrMobileGloballyService = async (email, mobile) => {
  try {
    const query = `
      SELECT * FROM ${tableNames.TENANT_USERS} 
      WHERE (email = ? OR (mobile = ? AND mobile IS NOT NULL)) 
      AND is_deleted = false 
      LIMIT 1
    `;
    const rows = await db.sequelize.query(query, {
      replacements: [email, mobile],
      type: db.Sequelize.QueryTypes.SELECT,
    });
    return rows[0];
  } catch (err) {
    throw err;
  }
};

export const loginTenantUserService = async (email) => {
  try {
    const Query = `
    SELECT * FROM ${tableNames.TENANT_USERS}
    WHERE email = ? AND is_deleted = ?
  `;

    const result = await db.sequelize.query(Query, {
      replacements: [email, 0],
      type: db.Sequelize.QueryTypes.SELECT,
    });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const findTenantUserByIdService = async (tenant_user_id) => {
  const Query = `SELECT * FROM ${tableNames?.TENANT_USERS} WHERE tenant_user_id = ? AND is_deleted = false LIMIT 1`;

  try {
    const result = await db.sequelize.query(Query, {
      replacements: [tenant_user_id],
      type: db.Sequelize.QueryTypes.SELECT,
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

export const updateTenantUserService = async (username, email, mobile, country_code, old_email) => {
  const updateFields = [];
  const updateValues = [];

  if (username) {
    updateFields.push("username = ?");
    updateValues.push(username);
  }

  if (email) {
    updateFields.push("email = ?");
    updateValues.push(email);
  }

  if (mobile) {
    updateFields.push("mobile = ?");
    updateValues.push(mobile);
  }

  if (country_code) {
    updateFields.push("country_code = ?");
    updateValues.push(country_code);
  }

  if (updateFields.length === 0) return null;

  updateValues.push(old_email);
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
  const dataQuery = `
    SELECT 
      tu.tenant_user_id,
      tu.title,
      tu.username,
      tu.email,
      tu.role,
      COALESCE(ti.status, tu.status) as status,
      tu.created_at
    FROM ${tableNames.TENANT_USERS} tu
    LEFT JOIN (
      SELECT tenant_user_id, status
      FROM ${tableNames.TENANT_INVITATIONS}
      WHERE id IN (
        SELECT MAX(id)
        FROM ${tableNames.TENANT_INVITATIONS}
        GROUP BY tenant_user_id
      )
    ) ti ON tu.tenant_user_id = ti.tenant_user_id
    WHERE tu.tenant_id = ?
      AND tu.is_deleted = false
    ORDER BY tu.created_at DESC
  `;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    return {
      users: rows,
    };
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

export const softDeleteTenantUserService = async (tenant_user_id, transaction = null) => {
  try {
    const query = `
    UPDATE ${tableNames.TENANT_USERS}
    SET is_deleted = true,
        deleted_at = NOW()
    WHERE tenant_user_id = ?
      AND is_deleted = false
  `;

    await db.sequelize.query(query, {
      replacements: [tenant_user_id],
      transaction,
    });
  } catch (err) {
    throw err;
  }
};

export const permanentDeleteTenantUserService = async (tenant_user_id, transaction = null) => {
  try {
    const query = `
    DELETE FROM ${tableNames.TENANT_USERS}
    WHERE tenant_user_id = ?
  `;

    await db.sequelize.query(query, {
      replacements: [tenant_user_id],
      transaction,
    });
  } catch (err) {
    throw err;
  }
};

export const getDeletedTenantUserListService = async (tenant_id) => {
  const query = `
    SELECT * FROM ${tableNames.TENANT_USERS}
    WHERE tenant_id = ? AND is_deleted = true
    ORDER BY deleted_at DESC
  `;

  try {
    const result = await db.sequelize.query(query, {
      replacements: [tenant_id],
      type: db.Sequelize.QueryTypes.SELECT,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const restoreTenantUserService = async (tenant_user_id, transaction = null) => {
  const query = `
    UPDATE ${tableNames.TENANT_USERS}
    SET is_deleted = false, deleted_at = NULL
    WHERE tenant_user_id = ?
  `;

  try {
    const [result] = await db.sequelize.query(query, {
      replacements: [tenant_user_id],
      transaction,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const findTenantAdminService = async (tenant_id) => {
  const query = `
    SELECT * FROM ${tableNames.TENANT_USERS}
    WHERE tenant_id = ? AND role = 'tenant_admin' AND is_deleted = false
    LIMIT 1
  `;

  try {
    const [rows] = await db.sequelize.query(query, {
      replacements: [tenant_id],
    });
    return rows[0];
  } catch (err) {
    throw err;
  }
};

export const updateTenantPasswordService = async (
  tenant_user_id,
  password_hash,
) => {
  const Query = `UPDATE ${tableNames.TENANT_USERS} SET password_hash = ? WHERE tenant_user_id = ? AND is_deleted = 0`;
  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [password_hash, tenant_user_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};
