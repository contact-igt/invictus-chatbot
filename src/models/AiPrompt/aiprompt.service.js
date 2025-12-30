import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { cleanText } from "../../utils/cleanText.js";

export const processAiPromptUpload = async (name, prompt) => {
  const Query = `
  INSERT INTO ${tableNames?.AIPROMPT} 
  (name, prompt)
  VALUES (?,?)`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [name, prompt],
    });

    return result;
  } catch (err) {
    throw err;
  }
};

export const listAiPromptService = async () => {
  try {
    const [result] = await db.sequelize.query(`
    SELECT id, name, prompt,  created_at , is_active
    FROM ${tableNames.AIPROMPT}
    ORDER BY created_at DESC
    `);

    return result;
  } catch (err) {
    throw err;
  }
};

export const getAiPromptByIdService = async (id) => {
  try {
    const [result] = await db.sequelize.query(
      `
    SELECT *
    FROM ${tableNames.AIPROMPT}
    WHERE id = ?
    `,
      { replacements: [id] }
    );
    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updateAiPromptService = async (id, name, prompt) => {
  const cleaned = cleanText(prompt);

  try {
    const [result] = await db.sequelize.query(
      `
    UPDATE ${tableNames.AIPROMPT}
    SET name = ?, prompt = ?
    WHERE id = ?
    `,
      { replacements: [name, cleaned, id] }
    );

    return result;
  } catch (err) {
    throw err;
  }
};

export const checkIsAnyActivePromptService = async () => {
  try {
    const [result] = await db.sequelize.query(
      `SELECT COUNT(*) as active_count FROM ${tableNames?.AIPROMPT} WHERE is_active = ? `,
      { replacements: ["true"] }
    );

    

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const updatePromptActiveService = async (id, is_active) => {
  try {
    const [result] = await db.sequelize.query(
      `
    UPDATE ${tableNames.AIPROMPT}
    SET is_active = ?
    WHERE id = ?
    `,
      { replacements: [is_active, id] }
    );

    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteAiPromptService = async (id) => {
  try {
    const [result] = await db.sequelize.query(
      `
    DELETE FROM ${tableNames.PROPMT}
    WHERE source_id = ?
    `,
      { replacements: [id] }
    );

    return result;
  } catch (err) {
    throw err;
  }
};
