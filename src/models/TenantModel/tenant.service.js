import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

export const createTenantService = async (
  tenant_id,
  company_name,
  owner_name,
  owner_email,
  owner_country_code,
  owner_mobile,
  type,
  subscription_start_date,
  subscription_end_date,
  profile,
  verify_token = null,
) => {
  const Query = `INSERT INTO ${tableNames?.TENANTS} (
      tenant_id,
      company_name,
      owner_name,
      owner_email,
      owner_country_code,
      owner_mobile,
      type,
      subscription_start_date,
      subscription_end_date,
      profile,
      verify_token
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`;

  try {
    const values = [
      tenant_id,
      company_name,
      owner_name,
      owner_email,
      owner_country_code,
      owner_mobile,
      type,
      subscription_start_date,
      subscription_end_date,
      profile,
      verify_token,
    ];
    console.log("values", values);

    const [result] = await db.sequelize.query(Query, {
      replacements: values,
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getAllTenantService = async () => {
  const dataQuery = `
  SELECT 
    t.*,
    ti.status as invite_status
  FROM ${tableNames?.TENANTS} t
  LEFT JOIN (
    SELECT email, status, tenant_id
    FROM ${tableNames.TENANT_INVITATIONS}
    WHERE id IN (
      SELECT MAX(id)
      FROM ${tableNames.TENANT_INVITATIONS}
      GROUP BY tenant_id, email
    )
  ) ti ON t.tenant_id = ti.tenant_id AND t.owner_email = ti.email
  WHERE t.is_deleted = ?
  ORDER BY t.created_at DESC`;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [0],
    });

    return rows;
  } catch (err) {
    throw err;
  }
};

export const findTenantByIdService = async (tenant_id) => {
  const Query = `SELECT * FROM ${tableNames?.TENANTS} WHERE tenant_id = ? AND is_deleted = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, 0],
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updateTenantService = async (
  company_name,
  owner_name,
  owner_email,
  owner_country_code,
  owner_mobile,
  type,
  tenant_id,
) => {
  const updateFields = [];
  const updateValues = [];

  if (company_name !== undefined && company_name !== null) {
    updateFields.push("company_name = ?");
    updateValues.push(company_name);
  }

  if (owner_name !== undefined && owner_name !== null) {
    updateFields.push("owner_name = ?");
    updateValues.push(owner_name);
  }

  if (owner_email !== undefined && owner_email !== null) {
    updateFields.push("owner_email = ?");
    updateValues.push(owner_email);
  }

  if (owner_country_code !== undefined && owner_country_code !== null) {
    updateFields.push("owner_country_code = ?");
    updateValues.push(owner_country_code);
  }

  if (owner_mobile !== undefined && owner_mobile !== null) {
    updateFields.push("owner_mobile = ?");
    updateValues.push(owner_mobile);
  }

  if (type !== undefined && type !== null) {
    updateFields.push("type = ?");
    updateValues.push(type);
  }

  if (updateFields.length === 0) return null;

  updateValues.push(tenant_id);
  updateValues.push(0);

  const Query = `
    UPDATE ${tableNames?.TENANTS}
    SET ${updateFields.join(", ")}
    WHERE tenant_id = ? AND is_deleted = ?
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

export const updateTenantStatusService = async (status, tenant_id) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET status = ? WHERE tenant_id = ? AND is_deleted = ? `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [status, tenant_id, 0],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const softDeleteTenantService = async (tenant_id) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET is_deleted = ? , deleted_at = NOW() WHERE tenant_id = ? AND is_deleted = false`;

  const Query2 = `UPDATE ${tableNames?.TENANT_USERS} SET is_deleted = ? , deleted_at = NOW() WHERE tenant_id IN(?) AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [true, tenant_id],
    });

    const [result2] = await db.sequelize.query(Query2, {
      replacements: [true, tenant_id],
    });

    return [result, result2];
  } catch (err) {
    throw err;
  }
};

export const deleteTenantService = async (tenant_id) => {
  const Query = `DELETE FROM ${tableNames?.TENANTS} WHERE tenant_id =  ?`;
  const Query2 = `DELETE FROM ${tableNames?.TENANT_USERS} WHERE tenant_id IN (?) `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });

    const [result2] = await db.sequelize.query(Query2, {
      replacements: [tenant_id],
    });

    return [result, result2];
  } catch (err) {
    throw err;
  }
};

export const getDeletedTenantListService = async () => {
  const Query = `
    SELECT * FROM ${tableNames.TENANTS}
    WHERE is_deleted = ?
    ORDER BY deleted_at DESC
  `;

  try {
    const result = await db.sequelize.query(Query, {
      replacements: [1],
      type: db.Sequelize.QueryTypes.SELECT,
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const restoreTenantService = async (tenant_id) => {
  const Query = `
    UPDATE ${tableNames.TENANTS}
    SET is_deleted = ?, deleted_at = NULL
    WHERE tenant_id = ?
  `;

  const Query2 = `
    UPDATE ${tableNames.TENANT_USERS}
    SET is_deleted = ?, deleted_at = NULL
    WHERE tenant_id = ?
  `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [0, tenant_id],
    });

    const [result2] = await db.sequelize.query(Query2, {
      replacements: [0, tenant_id],
    });

    return [result, result2];
  } catch (err) {
    throw err;
  }
};

export const activateTenantService = async (tenant_id) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET status = ? WHERE tenant_id = ? AND is_deleted = ?`;

  try {
    const values = ["active", tenant_id, 0];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateTenantVerifyTokenService = async (tenant_id, verify_token) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET verify_token = ? WHERE tenant_id = ? AND is_deleted = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [verify_token, tenant_id, 0],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateTenantWebhookStatusService = async (tenant_id, verified) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET webhook_verified = ? WHERE tenant_id = ? AND is_deleted = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [verified, tenant_id, 0],
    });
    return result;
  } catch (err) {
    throw err;
  }
};
