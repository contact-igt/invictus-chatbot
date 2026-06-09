import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const countActiveTenantUsersService = async (tenant_id) => {
  const [[{ count }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS count FROM ${tableNames.TENANT_USERS} WHERE tenant_id = ? AND is_deleted = 0`,
    { replacements: [tenant_id] },
  );
  return Number(count);
};

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
  transaction = null,
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
    const query = `SELECT * FROM ${tableNames.TENANT_USERS} WHERE email = ? AND is_deleted = ? LIMIT 1`;
    const rows = await db.sequelize.query(query, {
      replacements: [email, 0],
      type: db.Sequelize.QueryTypes.SELECT,
    });
    return rows[0];
  } catch (err) {
    throw err;
  }
};

export const findTenantUserByEmailOrMobileGloballyService = async (
  email,
  mobile,
) => {
  try {
    const query = `
      SELECT * FROM ${tableNames.TENANT_USERS} 
      WHERE (email = ? OR (mobile = ? AND mobile IS NOT NULL)) 
      AND is_deleted = ? 
      LIMIT 1
    `;
    const rows = await db.sequelize.query(query, {
      replacements: [email, mobile, 0],
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
  const Query = `SELECT * FROM ${tableNames?.TENANT_USERS} WHERE tenant_user_id = ? AND is_deleted = ? LIMIT 1`;

  try {
    const result = await db.sequelize.query(Query, {
      replacements: [tenant_user_id, 0],
      type: db.Sequelize.QueryTypes.SELECT,
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const findTenantUserByIdIgnoringDeleteService = async (
  tenant_user_id,
) => {
  const Query = `SELECT * FROM ${tableNames?.TENANT_USERS} WHERE tenant_user_id = ? LIMIT 1`;

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

export const getAllTenantUsersService = async (tenant_id) => {
  const dataQuery = `
    SELECT 
      tu.tenant_user_id,
      tu.title,
      tu.username,
      tu.email,
      tu.role,
      tu.mobile,
      tu.country_code,
      tu.status,
      tu.created_at
    FROM ${tableNames.TENANT_USERS} tu
    WHERE tu.tenant_id = ?
      AND tu.is_deleted = ?
    ORDER BY tu.created_at DESC
  `;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id, 0],
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

    const query = `
    UPDATE ${tableNames.TENANT_USERS}
    SET ${fields.join(", ")}, updated_at = NOW()
    WHERE tenant_user_id = ?
      AND is_deleted = ?
    `;

    await db.sequelize.query(query, {
      replacements: [...values, tenant_user_id, 0],
    });
  } catch (err) {
    throw err;
  }
};

export const permanentDeleteTenantUserService = async (
  tenant_user_id,
  transaction = null,
) => {
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
    WHERE tenant_id = ? AND is_deleted = ?
    ORDER BY deleted_at DESC
  `;

  try {
    const result = await db.sequelize.query(query, {
      replacements: [tenant_id, 1],
      type: db.Sequelize.QueryTypes.SELECT,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const restoreTenantUserService = async (
  tenant_user_id,
  transaction = null,
) => {
  const query = `
    UPDATE ${tableNames.TENANT_USERS}
    SET is_deleted = ?, deleted_at = NULL, status = 'active'
    WHERE tenant_user_id = ?
  `;

  try {
    const [result] = await db.sequelize.query(query, {
      replacements: [0, tenant_user_id],
      transaction,
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const softDeleteTenantUserService = async (tenant_user_id) => {
  const query = `UPDATE ${tableNames.TENANT_USERS} SET is_deleted = ?, status = ? WHERE tenant_user_id = ?`;
  try {
    const [result] = await db.sequelize.query(query, {
      replacements: [1, "inactive", tenant_user_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const softDeleteUsersByTenantIdService = async (tenant_id) => {
  const query = `UPDATE ${tableNames.TENANT_USERS} SET is_deleted = ?, status = ? WHERE tenant_id = ?`;
  try {
    const [result] = await db.sequelize.query(query, {
      replacements: [1, "inactive", tenant_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateUsersStatusByTenantIdService = async (
  tenant_id,
  status,
  transaction = null,
) => {
  const query = `UPDATE ${tableNames.TENANT_USERS} SET status = ? WHERE tenant_id = ? AND is_deleted = 0`;
  try {
    const [result] = await db.sequelize.query(query, {
      replacements: [status, tenant_id],
      ...(transaction && { transaction }),
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const findTenantAdminService = async (tenant_id) => {
  const query = `
    SELECT * FROM ${tableNames.TENANT_USERS}
    WHERE tenant_id = ? AND role = 'tenant_admin' AND is_deleted = ?
    LIMIT 1
  `;

  try {
    const [rows] = await db.sequelize.query(query, {
      replacements: [tenant_id, 0],
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
