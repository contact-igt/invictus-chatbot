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
    FROM ${tableNames.AIPROMPT}   WHERE tenant_id IN(?)
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
    WHERE id = ? AND tenant_id = ?
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
    WHERE id = ? AND tenant_id = ?
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
      `SELECT COUNT(*) as active_count FROM ${tableNames?.AIPROMPT} WHERE is_active = ? AND tenant_id IN (?) `,
      { replacements: ["true", tenant_id] },
    );

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updatePromptActiveService = async (id, tenant_id, is_active) => {
  try {
    const [result] = await db.sequelize.query(
      `
    UPDATE ${tableNames.AIPROMPT}
    SET is_active = ?
    WHERE id = ? AND tenant_id = ?
    `,
      { replacements: [is_active, id, tenant_id] },
    );

    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteAiPromptService = async (id, tenant_id) => {
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
      replacements: ["true", tenant_id],
    });
    return result[0]?.prompt;
  } catch (err) {
    throw err;
  }
};
