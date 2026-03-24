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
  status,
  subscription_start_date,
  subscription_end_date,
  address,
  city,
  country,
  state,
  pincode,
  max_users,
  subscription_plan,
  profile,
  verify_token = null,
) => {
  try {
    const result = await db.Tenants.create({
      tenant_id,
      company_name,
      owner_name,
      owner_email,
      owner_country_code,
      owner_mobile,
      type,
      status,
      subscription_start_date,
      subscription_end_date,
      address,
      city,
      country,
      state,
      pincode,
      max_users,
      subscription_plan,
      profile,
      verify_token,
    });

    return result;
  } catch (err) {
    console.error("[TENANT SERVICE] Error creating tenant:", err);
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
      GROUP BY tenant_id
    )
  ) ti ON t.tenant_id = ti.tenant_id
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
  status,
  subscription_start_date,
  subscription_end_date,
  address,
  city,
  country,
  state,
  pincode,
  max_users,
  subscription_plan,
  profile,
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

  if (status !== undefined && status !== null) {
    updateFields.push("status = ?");
    updateValues.push(status);
  }

  if (
    subscription_start_date !== undefined &&
    subscription_start_date !== null
  ) {
    updateFields.push("subscription_start_date = ?");
    updateValues.push(subscription_start_date);
  }

  if (subscription_end_date !== undefined && subscription_end_date !== null) {
    updateFields.push("subscription_end_date = ?");
    updateValues.push(subscription_end_date);
  }

  if (address !== undefined && address !== null) {
    updateFields.push("address = ?");
    updateValues.push(address);
  }

  if (country !== undefined && country !== null) {
    updateFields.push("country = ?");
    updateValues.push(country);
  }

  if (state !== undefined && state !== null) {
    updateFields.push("state = ?");
    updateValues.push(state);
  }

  if (city !== undefined && city !== null) {
    updateFields.push("city = ?");
    updateValues.push(city);
  }

  if (pincode !== undefined && pincode !== null) {
    updateFields.push("pincode = ?");
    updateValues.push(pincode);
  }

  if (max_users !== undefined && max_users !== null) {
    updateFields.push("max_users = ?");
    updateValues.push(max_users);
  }

  if (subscription_plan !== undefined && subscription_plan !== null) {
    updateFields.push("subscription_plan = ?");
    updateValues.push(subscription_plan);
  }

  if (profile !== undefined && profile !== null) {
    updateFields.push("profile = ?");
    updateValues.push(profile);
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
  const Query = `UPDATE ${tableNames?.TENANTS} SET is_deleted = ? , deleted_at = NOW() WHERE tenant_id = ? AND is_deleted = 0`;

  const Query2 = `UPDATE ${tableNames?.TENANT_USERS} SET is_deleted = ? , deleted_at = NOW() WHERE tenant_id IN(?) AND is_deleted = 0`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [1, tenant_id],
    });

    const [result2] = await db.sequelize.query(Query2, {
      replacements: [1, tenant_id],
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
    SELECT *, status as tenant_status FROM ${tableNames.TENANTS}
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
  // Restore tenant — preserve original status if it was 'invited' or 'trial', otherwise default to 'active'
  const Query = `
    UPDATE ${tableNames.TENANTS}
    SET is_deleted = ?, deleted_at = NULL,
        status = CASE
          WHEN status IN ('invited', 'trial', 'pending_setup') THEN status
          ELSE 'active'
        END
    WHERE tenant_id = ?
  `;

  const Query2 = `
    UPDATE ${tableNames.TENANT_USERS}
    SET is_deleted = ?, deleted_at = NULL,
        status = CASE
          WHEN (SELECT status FROM ${tableNames.TENANTS} WHERE tenant_id = ?) IN ('active', 'trial', 'grace_period') THEN 'active'
          ELSE 'inactive'
        END
    WHERE tenant_id = ?
  `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [0, tenant_id],
    });

    const [result2] = await db.sequelize.query(Query2, {
      replacements: [0, tenant_id, tenant_id],
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

export const updateTenantVerifyTokenService = async (
  tenant_id,
  verify_token,
) => {
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

export const getTenantInvitationListService = async () => {
  const query = `
    SELECT t.tenant_id, t.company_name, tu.username as owner_name, tu.email as owner_email, ti.status as invitation_status, ti.invited_at, ti.tenant_user_id
    FROM ${tableNames.TENANTS} t
    INNER JOIN ${tableNames.TENANT_USERS} tu ON t.tenant_id = tu.tenant_id AND tu.role = 'tenant_admin' AND tu.is_deleted = 0
    INNER JOIN ${tableNames.TENANT_INVITATIONS} ti ON tu.tenant_user_id = ti.tenant_user_id
    WHERE ti.id IN (
      SELECT MAX(id)
      FROM ${tableNames.TENANT_INVITATIONS}
      GROUP BY tenant_user_id
    ) AND t.is_deleted = ?
    ORDER BY ti.invited_at DESC`;

  try {
    const [rows] = await db.sequelize.query(query, {
      replacements: [0],
    });
    return rows;
  } catch (err) {
    throw err;
  }
};

export const getOnboardedTenantListService = async () => {
  const query = `
    SELECT 
      t.*
    FROM ${tableNames.TENANTS} t
    WHERE t.status IN ('active', 'trial', 'expired', 'suspended', 'inactive', 'maintenance', 'grace_period', 'pending_setup', 'invited') AND t.is_deleted = ?
    ORDER BY t.created_at DESC`;

  try {
    const [rows] = await db.sequelize.query(query, {
      replacements: [0],
    });
    return rows;
  } catch (err) {
    throw err;
  }
};

export const getTenantSettingsService = async (tenant_id) => {
  const Query = `SELECT company_name, owner_email, owner_name, type, ai_settings, default_contact_name FROM ${tableNames?.TENANTS} WHERE tenant_id = ? AND is_deleted = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, 0],
    });
    const tenantData = result[0];
    if (tenantData && typeof tenantData.ai_settings === "string") {
      try {
        tenantData.ai_settings = JSON.parse(tenantData.ai_settings);
      } catch (e) {
        console.error("Failed to parse ai_settings on read");
      }
    }
    return tenantData;
  } catch (err) {
    throw err;
  }
};

export const updateTenantAiSettingsService = async (tenant_id, ai_settings) => {
  // Merge existing settings before updating
  const currentSettings = await getTenantSettingsService(tenant_id);

  let parsedSettings = {};
  if (currentSettings && currentSettings.ai_settings) {
    if (typeof currentSettings.ai_settings === "string") {
      try {
        parsedSettings = JSON.parse(currentSettings.ai_settings);
      } catch (e) {
        console.error("Failed to parse ai_settings string");
      }
    } else {
      parsedSettings = currentSettings.ai_settings;
    }
  }

  const updatedSettings = {
    ...parsedSettings,
    ...ai_settings,
  };

  const Query = `UPDATE ${tableNames?.TENANTS} SET ai_settings = ? WHERE tenant_id = ? AND is_deleted = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [JSON.stringify(updatedSettings), tenant_id, 0],
    });
    return Object.keys(result).length > 0;
  } catch (err) {
    throw err;
  }
};

export const updateTenantGeneralSettingsService = async (
  tenant_id,
  default_contact_name,
) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET default_contact_name = ? WHERE tenant_id = ? AND is_deleted = ?`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [default_contact_name || null, tenant_id, 0],
    });
    return result;
  } catch (err) {
    throw err;
  }
};
