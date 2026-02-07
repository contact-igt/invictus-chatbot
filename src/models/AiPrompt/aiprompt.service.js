import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { cleanText } from "../../utils/cleanText.js";

export const processAiPromptUpload = async (tenant_id, name, prompt) => {
  const Query = `
  INSERT INTO ${tableNames?.AIPROMPT} 
  (tenant_id , name, prompt)
  VALUES (?,?,?)`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id, name, prompt],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const listAiPromptService = async (tenant_id) => {
  const Query = `
    SELECT id, name, prompt,  created_at , is_active
    FROM ${tableNames.AIPROMPT}   WHERE tenant_id IN(?) AND is_deleted = false
    ORDER BY created_at DESC
    `;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const getAiPromptByIdService = async (id, tenant_id) => {
  try {
    const [result] = await db.sequelize.query(
      `
    SELECT *
    FROM ${tableNames.AIPROMPT}
    WHERE id = ? AND tenant_id = ? AND is_deleted = false
    `,
      { replacements: [id, tenant_id] },
    );
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updateAiPromptService = async (id, tenant_id, name, prompt) => {
  const cleaned = cleanText(prompt);

  try {
    const [result] = await db.sequelize.query(
      `
    UPDATE ${tableNames.AIPROMPT}
    SET name = ?, prompt = ?
    WHERE id = ? AND tenant_id = ? AND is_deleted = false
    `,
      { replacements: [name, cleaned, id, tenant_id] },
    );

    return result;
  } catch (err) {
    throw err;
  }
};

export const checkIsAnyActivePromptService = async (tenant_id) => {
  try {
    const [result] = await db.sequelize.query(
      `SELECT COUNT(*) as active_count FROM ${tableNames?.AIPROMPT} WHERE is_active = ? AND tenant_id IN (?) AND is_deleted = false`,
      { replacements: [true, tenant_id] },
    );

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updatePromptActiveService = async (id, tenant_id, is_active) => {
  const transaction = await db.sequelize.transaction();
  try {
    if (String(is_active) === "true") {
      // 1. Deactivate all others for this tenant
      await db.sequelize.query(
        `UPDATE ${tableNames.AIPROMPT} SET is_active = false WHERE tenant_id = ?`,
        { replacements: [tenant_id], transaction },
      );
    }

    // 2. Activate/Deactivate target
    await db.sequelize.query(
      `
    UPDATE ${tableNames.AIPROMPT}
    SET is_active = ?
    WHERE id = ? AND tenant_id = ? AND is_deleted = false
    `,
      { replacements: [is_active, id, tenant_id], transaction },
    );

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const deleteAiPromptService = async (id, tenant_id) => {
  try {
    const [result] = await db.sequelize.query(
      `
    UPDATE ${tableNames.AIPROMPT}
    SET is_deleted = true, deleted_at = NOW()
    WHERE id = ? AND tenant_id = ? AND is_deleted = false
    `,
      { replacements: [id, tenant_id] },
    );

    return result;
  } catch (err) {
    throw err;
  }
};

export const permanentDeleteAiPromptService = async (id, tenant_id) => {
  try {
    const [result] = await db.sequelize.query(
      `
    DELETE FROM ${tableNames.AIPROMPT}
    WHERE id = ? AND tenant_id = ?
    `,
      { replacements: [id, tenant_id] },
    );

    return result;
  } catch (err) {
    throw err;
  }
};

export const getActivePromptService = async (tenant_id) => {
  const Query = `SELECT prompt FROM ${tableNames?.AIPROMPT} WHERE is_active = ? AND tenant_id = ? LIMIT 1`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [true, tenant_id],
    });
    return result[0]?.prompt;
  } catch (err) {
    throw err;
  }
};

/**
 * Retrieves a list of soft-deleted AI prompts for a tenant.
 */
export const getDeletedAiPromptListService = async (tenant_id, query) => {
  const { search, page = 1, limit = 10 } = query;
  const offset = (page - 1) * limit;

  let where = { tenant_id, is_deleted: true };
  if (search) {
    where.name = { [db.Sequelize.Op.like]: `%${search}%` };
  }

  const { count, rows } = await db.AiPrompts.findAndCountAll({
    where,
    order: [["deleted_at", "DESC"]],
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  return {
    totalItems: count,
    prompts: rows,
    totalPages: Math.ceil(count / limit),
    currentPage: parseInt(page),
  };
};

/**
 * Restore a soft-deleted AI prompt
 */
export const restoreAiPromptService = async (id, tenant_id) => {
  const prompt = await db.AiPrompts.findOne({
    where: { id, tenant_id, is_deleted: true }
  });

  if (!prompt) {
    throw new Error("Prompt not found or not deleted");
  }

  await prompt.update({
    is_deleted: false,
    deleted_at: null
  });

  return { message: "Prompt restored successfully" };
};
