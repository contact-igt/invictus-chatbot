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
  ai_settings = null,
  transaction = null,
) => {
  try {
    // Merge default AI settings with provided ones
    const defaultAiSettings = {
      auto_responder: true,
      smart_reply: true,
      neural_summary: true,
      content_generation: true,
      input_model: "gpt-4o-mini",
      output_model: "gpt-4o",
      openai_api_key: "",
    };

    const mergedAiSettings = ai_settings
      ? { ...defaultAiSettings, ...ai_settings }
      : defaultAiSettings;

    const result = await db.Tenants.create(
      {
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
        ai_settings: mergedAiSettings,
      },
      transaction ? { transaction } : undefined,
    );

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
  ai_settings,
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

  // Handle AI settings - merge with existing settings to preserve other fields
  if (ai_settings !== undefined && ai_settings !== null) {
    // Fetch existing ai_settings to merge
    const existingTenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["ai_settings"],
      raw: true,
    });

    let existingAiSettings = {};
    if (existingTenant?.ai_settings) {
      try {
        existingAiSettings =
          typeof existingTenant.ai_settings === "string"
            ? JSON.parse(existingTenant.ai_settings)
            : existingTenant.ai_settings;
      } catch (e) {
        existingAiSettings = {};
      }
    }

    // Merge: keep existing settings, update only provided fields
    const mergedAiSettings = { ...existingAiSettings, ...ai_settings };
    updateFields.push("ai_settings = ?");
    updateValues.push(JSON.stringify(mergedAiSettings));
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

export const updateTenantStatusService = async (
  status,
  tenant_id,
  transaction = null,
) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET status = ? WHERE tenant_id = ? AND is_deleted = ? `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [status, tenant_id, 0],
      ...(transaction && { transaction }),
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const softDeleteTenantService = async (tenant_id) => {
  const transaction = await db.sequelize.transaction();

  try {
    // ── Soft-delete tables (have is_deleted column) ──
    const softDeleteTables = [
      tableNames.TENANTS,
      tableNames.TENANT_USERS,
      tableNames.CONTACTS,
      tableNames.CONTACT_GROUPS,
      tableNames.DOCTORS,
      tableNames.SPECIALIZATIONS,
      tableNames.WHATSAPP_TEMPLATE,
      tableNames.KNOWLEDGESOURCE,
      tableNames.KNOWLEDGECHUNKS,
      tableNames.AIPROMPT,
      tableNames.APPOINTMENTS,
      tableNames.LEADS,
      tableNames.LIVECHAT,
    ];

    for (const table of softDeleteTables) {
      await db.sequelize.query(
        `UPDATE ${table} SET is_deleted = 1, deleted_at = NOW() WHERE tenant_id = ? AND is_deleted = 0`,
        { replacements: [tenant_id], transaction },
      );
    }

    // ── Hard-delete child records that have no is_deleted (orphan prevention) ──
    // NOTE: These child records are left intact during soft-delete.
    // Their parent records (templates, campaigns, doctors, contacts) are soft-deleted,
    // making these children unreachable. They are only hard-deleted on permanent delete.
    // This ensures full data recovery on restore.

    // Now soft-delete tenant-scoped tables without is_deleted (mark via parent)
    // Campaigns and WhatsApp accounts are soft-deleted via tenant scope
    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_CAMPAIGN} SET is_deleted = 1, deleted_at = NOW() WHERE tenant_id = ? AND is_deleted = 0`,
      { replacements: [tenant_id], transaction },
    );
    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_ACCOUNT} SET is_deleted = 1, deleted_at = NOW() WHERE tenant_id = ? AND is_deleted = 0`,
      { replacements: [tenant_id], transaction },
    );

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const deleteTenantService = async (tenant_id) => {
  const transaction = await db.sequelize.transaction();

  try {
    // ── Delete child records that reference parent IDs first (FK safety) ──

    // Template components, variables, sync logs → via template_id
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} WHERE template_id IN (SELECT template_id FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE tenant_id = ?)`,
      { replacements: [tenant_id], transaction },
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} WHERE template_id IN (SELECT template_id FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE tenant_id = ?)`,
      { replacements: [tenant_id], transaction },
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS} WHERE template_id IN (SELECT template_id FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE tenant_id = ?)`,
      { replacements: [tenant_id], transaction },
    );

    // Campaign recipients → via campaign_id
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} WHERE campaign_id IN (SELECT campaign_id FROM ${tableNames.WHATSAPP_CAMPAIGN} WHERE tenant_id = ?)`,
      { replacements: [tenant_id], transaction },
    );

    // Contact group members → via group_id
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACT_GROUP_MEMBERS} WHERE group_id IN (SELECT group_id FROM ${tableNames.CONTACT_GROUPS} WHERE tenant_id = ?)`,
      { replacements: [tenant_id], transaction },
    );

    // Doctor availability & specializations → via doctor_id
    await db.sequelize.query(
      `DELETE FROM ${tableNames.DOCTOR_AVAILABILITY} WHERE doctor_id IN (SELECT doctor_id FROM ${tableNames.DOCTORS} WHERE tenant_id = ?)`,
      { replacements: [tenant_id], transaction },
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.DOCTOR_SPECIALIZATIONS} WHERE doctor_id IN (SELECT doctor_id FROM ${tableNames.DOCTORS} WHERE tenant_id = ?)`,
      { replacements: [tenant_id], transaction },
    );

    // ── Delete all tenant-scoped tables ──
    const allTenantTables = [
      tableNames.MESSAGES,
      tableNames.PROCESSEDMESSAGE,
      tableNames.CHATLOCKS,
      tableNames.LIVECHAT,
      tableNames.WHATSAPP_TEMPLATE,
      tableNames.WHATSAPP_CAMPAIGN,
      tableNames.WHATSAPP_ACCOUNT,
      tableNames.CONTACTS,
      tableNames.CONTACT_GROUPS,
      tableNames.DOCTORS,
      tableNames.SPECIALIZATIONS,
      tableNames.APPOINTMENTS,
      tableNames.LEADS,
      tableNames.KNOWLEDGESOURCE,
      tableNames.KNOWLEDGECHUNKS,
      tableNames.AIPROMPT,
      tableNames.AI_TOKEN_USAGE,
      tableNames.MESSAGE_USAGE,
      tableNames.BILLING_LEDGER,
      tableNames.WALLET_TRANSACTIONS,
      tableNames.WALLETS,
      tableNames.OTP_VERIFICATIONS,
      tableNames.TENANT_INVITATIONS,
      tableNames.TENANT_USERS,
      tableNames.TENANTS, // Delete tenant last
    ];

    for (const table of allTenantTables) {
      await db.sequelize.query(`DELETE FROM ${table} WHERE tenant_id = ?`, {
        replacements: [tenant_id],
        transaction,
      });
    }

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
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
  const transaction = await db.sequelize.transaction();

  try {
    // Restore tenant — preserve original status if it was 'invited' or 'trial', otherwise default to 'active'
    await db.sequelize.query(
      `UPDATE ${tableNames.TENANTS}
       SET is_deleted = 0, deleted_at = NULL,
           status = CASE
             WHEN status IN ('invited', 'trial', 'pending_setup') THEN status
             ELSE 'active'
           END
       WHERE tenant_id = ?`,
      { replacements: [tenant_id], transaction },
    );

    // Restore tenant users with appropriate status
    await db.sequelize.query(
      `UPDATE ${tableNames.TENANT_USERS}
       SET is_deleted = 0, deleted_at = NULL,
           status = CASE
             WHEN (SELECT status FROM ${tableNames.TENANTS} WHERE tenant_id = ?) IN ('active', 'trial', 'grace_period') THEN 'active'
             ELSE 'inactive'
           END
       WHERE tenant_id = ?`,
      { replacements: [tenant_id, tenant_id], transaction },
    );

    // Restore all other soft-deleted tenant data
    const softDeleteTables = [
      tableNames.CONTACTS,
      tableNames.CONTACT_GROUPS,
      tableNames.DOCTORS,
      tableNames.SPECIALIZATIONS,
      tableNames.WHATSAPP_TEMPLATE,
      tableNames.KNOWLEDGESOURCE,
      tableNames.KNOWLEDGECHUNKS,
      tableNames.AIPROMPT,
      tableNames.APPOINTMENTS,
      tableNames.LEADS,
      tableNames.LIVECHAT,
      tableNames.WHATSAPP_CAMPAIGN,
      tableNames.WHATSAPP_ACCOUNT,
    ];

    for (const table of softDeleteTables) {
      await db.sequelize.query(
        `UPDATE ${table} SET is_deleted = 0, deleted_at = NULL WHERE tenant_id = ? AND is_deleted = 1`,
        { replacements: [tenant_id], transaction },
      );
    }

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const activateTenantService = async (tenant_id) => {
  const Query = `UPDATE ${tableNames?.TENANTS} SET status = ? WHERE tenant_id = ? AND is_deleted = ? AND status IN ('inactive', 'invited')`;

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
  // Only return tenants that have completed full onboarding:
  // 1. Tenant exists and is not in 'invited' status
  // 2. Password set (tenant_users.password_hash is not null AND status = 'active')
  // 3. WhatsApp connected (whatsapp_accounts entry exists with status 'active' or 'verified')
  const query = `
    SELECT 
      t.tenant_id,
      t.company_name,
      t.owner_name,
      t.owner_email,
      t.owner_mobile,
      t.owner_country_code,
      t.type,
      t.status,
      t.subscription_plan,
      t.subscription_end_date,
      t.billing_mode,
      t.created_at,
      t.deleted_at,
      (
        SELECT wa_inner.whatsapp_number 
        FROM ${tableNames.WHATSAPP_ACCOUNT} wa_inner 
        WHERE wa_inner.tenant_id = t.tenant_id 
          AND wa_inner.status IN ('active', 'verified') 
          AND wa_inner.is_deleted = false 
        ORDER BY wa_inner.created_at DESC 
        LIMIT 1
      ) as whatsapp_number,
      (
        SELECT wa_inner.status 
        FROM ${tableNames.WHATSAPP_ACCOUNT} wa_inner 
        WHERE wa_inner.tenant_id = t.tenant_id 
          AND wa_inner.status IN ('active', 'verified') 
          AND wa_inner.is_deleted = false 
        ORDER BY wa_inner.created_at DESC 
        LIMIT 1
      ) as whatsapp_status
    FROM ${tableNames.TENANTS} t
    INNER JOIN ${tableNames.TENANT_USERS} tu ON t.tenant_id = tu.tenant_id 
      AND tu.role = 'tenant_admin' 
      AND tu.password_hash IS NOT NULL 
      AND tu.status = 'active'
      AND tu.is_deleted = false
    WHERE t.is_deleted = false
      AND t.status != 'invited'
      AND EXISTS (
        SELECT 1 FROM ${tableNames.WHATSAPP_ACCOUNT} wa 
        WHERE wa.tenant_id = t.tenant_id 
          AND wa.status IN ('active', 'verified') 
          AND wa.is_deleted = false
      )
    GROUP BY t.tenant_id
    ORDER BY t.created_at DESC`;

  try {
    const [rows] = await db.sequelize.query(query);
    return rows;
  } catch (err) {
    console.error("[getOnboardedTenantListService] Error:", err);
    throw err;
  }
};

export const getTenantSettingsService = async (tenant_id) => {
  const Query = `SELECT company_name, owner_email, owner_name, type, ai_settings FROM ${tableNames?.TENANTS} WHERE tenant_id = ? AND is_deleted = ?`;

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
