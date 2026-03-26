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
  try {
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
      password,
      role,
    ];

    const [result] = await db.sequelize.query(Query, { replacements: values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const loginManagementService = async (email) => {
  try {
    const Query = `
    SELECT * FROM ${tableNames.MANAGEMENT}
    WHERE email = ? AND is_deleted = false
  `;

    const result = await db.sequelize.query(Query, {
      replacements: [email],
      type: db.Sequelize.QueryTypes.SELECT,
    });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const findManagementByEmailService = async (email) => {
  try {
    const Query = `SELECT * FROM ${tableNames.MANAGEMENT} WHERE email = ? AND is_deleted = false LIMIT 1`;
    const result = await db.sequelize.query(Query, {
      replacements: [email],
      type: db.Sequelize.QueryTypes.SELECT,
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const findManagementByEmailOrMobileService = async (email, mobile) => {
  try {
    const Query = `
      SELECT * FROM ${tableNames.MANAGEMENT} 
      WHERE (email = ? OR (mobile = ? AND mobile IS NOT NULL)) 
      AND is_deleted = false 
      LIMIT 1
    `;
    const result = await db.sequelize.query(Query, {
      replacements: [email, mobile],
      type: db.Sequelize.QueryTypes.SELECT,
    });
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getAllManagementService = async () => {
  const dataQuery = `
    SELECT *
    FROM ${tableNames.MANAGEMENT}
    WHERE is_deleted = ?
    ORDER BY created_at DESC
  `;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [0],
    });

    return {
      users: rows,
    };
  } catch (err) {
    throw err;
  }
};

export const getAllManagementAdminService = async (role) => {
  const dataQuery = `
    SELECT *
    FROM ${tableNames.MANAGEMENT}
    WHERE role = ? AND is_deleted = ?
    ORDER BY created_at DESC
  `;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [role, 0],
    });

    return {
      users: rows,
    };
  } catch (err) {
    throw err;
  }
};

export const getManagementByIdService = async (management_id) => {
  try {
    const Query = `
    SELECT * FROM ${tableNames.MANAGEMENT}
    WHERE management_id = ? AND is_deleted = ?
  `;

    const result = await db.sequelize.query(Query, {
      replacements: [management_id, 0],
      type: db.Sequelize.QueryTypes.SELECT,
    });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updateManagementService = async (
  targetUserId,
  title,
  username,
  country_code,
  mobile,
  profile,
  role,
  status,
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

export const softDeleteManagementService = async (management_id) => {
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

export const getDeletedManagementListService = async () => {
  const Query = `
    SELECT * FROM ${tableNames.MANAGEMENT}
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

export const restoreManagementService = async (management_id) => {
  const Query = `
    UPDATE ${tableNames.MANAGEMENT}
    SET is_deleted = ?, deleted_at = NULL
    WHERE management_id = ?
  `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [0, management_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const updateManagementPasswordService = async (
  management_id,
  password_hash,
) => {
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

// ─── Pricing Table CRUD Services ─────────────────────────────

export const getPricingRulesService = async () => {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.PRICING_TABLE}`,
    );
    return rows;
  } catch (err) {
    throw err;
  }
};

export const createPricingRuleService = async (
  category,
  country,
  rate,
  markup_percent = 0,
) => {
  try {
    const [existing] = await db.sequelize.query(
      `SELECT id FROM ${tableNames.PRICING_TABLE} WHERE category = ? AND country = ? LIMIT 1`,
      { replacements: [category, country] },
    );
    if (existing.length > 0) {
      throw new Error(
        `Pricing rule already exists for ${category} / ${country}`,
      );
    }

    const [result] = await db.sequelize.query(
      `INSERT INTO ${tableNames.PRICING_TABLE} (category, country, rate, markup_percent, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      { replacements: [category, country, rate, markup_percent] },
    );
    return result;
  } catch (err) {
    throw err;
  }
};

export const updatePricingRuleService = async (id, rate, markup_percent) => {
  try {
    const updateFields = [];
    const values = [];

    if (rate !== undefined && rate !== null) {
      updateFields.push("rate = ?");
      values.push(rate);
    }
    if (markup_percent !== undefined && markup_percent !== null) {
      updateFields.push("markup_percent = ?");
      values.push(markup_percent);
    }

    if (updateFields.length === 0) {
      throw new Error("No fields to update");
    }

    updateFields.push("updated_at = NOW()");
    values.push(id);

    const [result] = await db.sequelize.query(
      `UPDATE ${tableNames.PRICING_TABLE} SET ${updateFields.join(", ")} WHERE id = ?`,
      { replacements: values },
    );
    return result;
  } catch (err) {
    throw err;
  }
};

export const deletePricingRuleService = async (id) => {
  try {
    const [result] = await db.sequelize.query(
      `DELETE FROM ${tableNames.PRICING_TABLE} WHERE id = ?`,
      { replacements: [id] },
    );
    return result;
  } catch (err) {
    throw err;
  }
};

// ─── AI Model Pricing CRUD Services ─────────────────────────────

export const getAiPricingRulesService = async () => {
  try {
    const rules = await db.AiPricing.findAll({
      order: [["model", "ASC"]],
      raw: true,
    });
    return rules;
  } catch (err) {
    throw err;
  }
};

export const createAiPricingRuleService = async (
  model,
  input_rate,
  output_rate,
  markup_percent = 0,
  usd_to_inr_rate = 85,
  description = null,
  recommended_for = "both",
  category = "mid-tier",
) => {
  try {
    const existing = await db.AiPricing.findOne({ where: { model } });
    if (existing) {
      throw new Error(`AI pricing rule already exists for model: ${model}`);
    }

    const rule = await db.AiPricing.create({
      model,
      input_rate,
      output_rate,
      markup_percent,
      usd_to_inr_rate,
      description,
      recommended_for,
      category,
      is_active: true,
    });
    return rule;
  } catch (err) {
    throw err;
  }
};

export const updateAiPricingRuleService = async (id, data) => {
  try {
    const rule = await db.AiPricing.findByPk(id);
    if (!rule) {
      throw new Error("AI pricing rule not found");
    }

    const updateFields = {};
    if (data.input_rate !== undefined)
      updateFields.input_rate = data.input_rate;
    if (data.output_rate !== undefined)
      updateFields.output_rate = data.output_rate;
    if (data.markup_percent !== undefined)
      updateFields.markup_percent = data.markup_percent;
    if (data.usd_to_inr_rate !== undefined)
      updateFields.usd_to_inr_rate = data.usd_to_inr_rate;
    if (data.is_active !== undefined) updateFields.is_active = data.is_active;
    if (data.description !== undefined)
      updateFields.description = data.description;
    if (data.recommended_for !== undefined)
      updateFields.recommended_for = data.recommended_for;
    if (data.category !== undefined) updateFields.category = data.category;

    await rule.update(updateFields);
    return rule;
  } catch (err) {
    throw err;
  }
};

export const deleteAiPricingRuleService = async (id) => {
  try {
    const rule = await db.AiPricing.findByPk(id);
    if (!rule) {
      throw new Error("AI pricing rule not found");
    }
    await rule.destroy();
    return { deleted: true };
  } catch (err) {
    throw err;
  }
};
