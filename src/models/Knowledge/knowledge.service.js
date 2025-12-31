import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { chunkText } from "../../utils/chunkText.js";
import { cleanText } from "../../utils/cleanText.js";

export const processKnowledgeUpload = async (
  title,
  type,
  source_url,
  text,
  file_name
) => {
  const Query = `
  INSERT INTO ${tableNames?.KNOWLEDGESOURCE} 
  (title , type , source_url , raw_text , file_name)
  VALUES (?,?,?,?,?)`;

  const Query2 = ` 
  INSERT INTO ${tableNames.KNOWLEDGECHUNKS}
  (source_id, chunk_text, embedding)
  VALUES (?, ?, ?)`;

  try {
    const [result] = await db.sequelize.query(Query, {
      replacements: [title, type, source_url, text, file_name],
    });

    const sourceId = result;

    const chunks = chunkText(text);

    for (const chunk of chunks) {
      await db.sequelize.query(Query2, {
        replacements: [sourceId, chunk, JSON.stringify([])],
      });
    }
  } catch (err) {
    throw err;
  }
};

export const listKnowledgeService = async () => {
  try {
    const [result] = await db.sequelize.query(`
    SELECT id, title, type, source_url,  file_name , created_at
    FROM ${tableNames.KNOWLEDGESOURCE}
    ORDER BY created_at DESC
    `);

    return result;
  } catch (err) {
    throw err;
  }
};

export const getKnowledgeByIdService = async (id) => {
  const [rows] = await db.sequelize.query(
    `
    SELECT *
    FROM ${tableNames.KNOWLEDGESOURCE}
    WHERE id = ?
    `,
    { replacements: [id] }
  );
  return rows[0];
};

export const updateKnowledgeService = async (id, title, text) => {
  const cleaned = cleanText(text);

  // 1️⃣ Update source
  await db.sequelize.query(
    `
    UPDATE ${tableNames.KNOWLEDGESOURCE}
    SET title = ?, raw_text = ?
    WHERE id = ?
    `,
    { replacements: [title, cleaned, id] }
  );

  // 2️⃣ Delete old chunks
  await db.sequelize.query(
    `
    DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
    WHERE source_id = ?
    `,
    { replacements: [id] }
  );

  // 3️⃣ Recreate chunks
  const chunks = chunkText(cleaned);

  for (const chunk of chunks) {
    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.KNOWLEDGECHUNKS}
      (source_id, chunk_text, embedding)
      VALUES (?, ?, ?)
      `,
      { replacements: [id, chunk, JSON.stringify([])] }
    );
  }
};

export const deleteKnowledgeService = async (id) => {
  // 1️⃣ Delete chunks
  await db.sequelize.query(
    `
    DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
    WHERE source_id = ?
    `,
    { replacements: [id] }
  );

  // 2️⃣ Delete source
  await db.sequelize.query(
    `
    DELETE FROM ${tableNames.KNOWLEDGESOURCE}
    WHERE id = ?
    `,
    { replacements: [id] }
  );
};
