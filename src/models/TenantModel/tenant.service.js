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
      profile
  ) VALUES (?,?,?,?,?,?,?,?,?,?)`;

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
  const Query = `
  SELECT 
    t.*,
    COALESCE(ti.status, t.status) as status
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
  WHERE t.is_deleted IN(?)
  ORDER BY t.tenant_id DESC  `;

  try {
    const [result] = await db.sequelize.query(Query, { replacements: [0] });
    return result;
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

  if (company_name) {
    updateFields.push("company_name = ?");
    updateValues.push(company_name);
  }

  if (owner_name) {
    updateFields.push("owner_name = ?");
    updateValues.push(owner_name);
  }

  if (owner_email) {
    updateFields.push("owner_email = ?");
    updateValues.push(owner_email);
  }

  if (owner_country_code) {
    updateFields.push("owner_country_code = ?");
    updateValues.push(owner_country_code);
  }

  if (owner_mobile) {
    updateFields.push("owner_mobile = ?");
    updateValues.push(owner_mobile);
  }

  if (type) {
    updateFields.push("type = ?");
    updateValues.push(type);
  }

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

// export const updateTenantStatusService = async (status, tenant_id) => {
//   const Query = `UPDATE ${tableNames?.TENANTS} SET status = ? WHERE tenant_id = ? AND is_deleted = ? `;

//   try {
//     const [result] = await db.sequelize.query(Query, {
//       replacements: [status, tenant_id, 0],
//     });

//     return result;
//   } catch (err) {
//     throw err;
//   }
// };

export const deleteTenantStatusService = async (tenant_id) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET is_deleted = ? , deleted_at = NOW() WHERE tenant_id = ? AND is_deleted = false`;

  const Query2 = `UPDATE ${tableNames?.TENANT_USERS} SET is_deleted = ? , deleted_at = NOW() WHERE tenant_id IN(?) AND is_deleted = false`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [true, tenant_id],
    });

    const [result2] = await db.sequelize.query(Query2, {
      replacements: [true, tenant_id],
    });

    return (result, result2);
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

    return (result, result2);
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
