import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { chunkText } from "../../utils/chunkText.js";
import { cleanText } from "../../utils/cleanText.js";

export const processKnowledgeUpload = async (
  tenant_id,
  title,
  type,
  source_url,
  text,
  file_name,
) => {
  const Query = `
  INSERT INTO ${tableNames?.KNOWLEDGESOURCE} 
  ( tenant_id, title , type , source_url , raw_text , file_name)
  VALUES (?,?,?,?,?,?)`;

  const Query2 = ` 
  INSERT INTO ${tableNames.KNOWLEDGECHUNKS}
  ( tenant_id, source_id, chunk_text, embedding)
  VALUES (?, ?, ?, ?)`;

  try {
    const [sourceId] = await db.sequelize.query(Query, {
      replacements: [tenant_id, title, type, source_url, text, file_name],
      type: db.Sequelize.QueryTypes.INSERT,
    });

    const chunks = chunkText(text);

    for (const chunk of chunks) {
      await db.sequelize.query(Query2, {
        replacements: [tenant_id, sourceId, chunk, JSON.stringify([])],
      });
    }
  } catch (err) {
    throw err;
  }
};

export const listKnowledgeService = async (tenant_id) => {
  const Query = `
    SELECT id, title, type, source_url, file_name , status , created_at
    FROM ${tableNames.KNOWLEDGESOURCE} WHERE tenant_id IN (?) AND is_deleted = false
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

export const getKnowledgeByIdService = async (id, tenant_id) => {
  const [rows] = await db.sequelize.query(
    `
    SELECT *
    FROM ${tableNames.KNOWLEDGESOURCE}
    WHERE id = ? AND tenant_id = ? AND is_deleted = false
    `,
    { replacements: [id, tenant_id] },
  );
  return rows[0];
};

export const updateKnowledgeService = async (id, tenant_id, title, text) => {
  const cleaned = cleanText(text);

  // 1️⃣ Update source
  await db.sequelize.query(
    `
    UPDATE ${tableNames.KNOWLEDGESOURCE}
    SET title = ?, raw_text = ?
    WHERE id = ? AND tenant_id = ? AND is_deleted = false
    `,
    { replacements: [title, cleaned, id, tenant_id] },
  );

  // 2️⃣ Delete old chunks
  await db.sequelize.query(
    `
    DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
    WHERE source_id = ? AND tenant_id = ?
    `,
    { replacements: [id, tenant_id] },
  );

  // 3️⃣ Recreate chunks
  const chunks = chunkText(cleaned);

  for (const chunk of chunks) {
    await db.sequelize.query(
      `
      INSERT INTO ${tableNames.KNOWLEDGECHUNKS}
      (tenant_id , source_id, chunk_text, embedding)
      VALUES (?, ?, ? , ?)
      `,
      { replacements: [tenant_id, id, chunk, JSON.stringify([])] },
    );
  }
};

export const deleteKnowledgeService = async (id, tenant_id) => {
  await db.sequelize.query(
    `
    UPDATE ${tableNames.KNOWLEDGESOURCE}
    SET is_deleted = true, deleted_at = NOW()
    WHERE id = ? AND tenant_id = ? AND is_deleted = false
    `,
    { replacements: [id, tenant_id] },
  );
};

export const permanentDeleteKnowledgeService = async (id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    // 1. Delete Chunks
    await db.sequelize.query(`DELETE FROM ${tableNames.KNOWLEDGECHUNKS} WHERE source_id = ? AND tenant_id = ?`, {
      replacements: [id, tenant_id],
      transaction,
    });

    // 2. Delete Source
    await db.sequelize.query(`DELETE FROM ${tableNames.KNOWLEDGESOURCE} WHERE id = ? AND tenant_id = ?`, {
      replacements: [id, tenant_id],
      transaction,
    });

    await transaction.commit();
    return true;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const updateKnowledgeStatusService = async (status, id, tenant_id) => {
  const Query = ` UPDATE ${tableNames?.KNOWLEDGESOURCE} SET status = ? WHERE id = ? AND tenant_id = ? AND is_deleted = false`;

  try {
    const values = [status, id, tenant_id];

    const [result] = await db.sequelize.query(Query, { replacements: values });

    return result;
  } catch (err) {
    throw err;
  }
};

/**
 * Retrieves a list of soft-deleted knowledge sources for a tenant.
 */
export const getDeletedKnowledgeListService = async (tenant_id, query) => {
  const { type, search, page = 1, limit = 10 } = query;
  const offset = (page - 1) * limit;

  let where = { tenant_id, is_deleted: true };
  if (type) where.source_type = type;
  if (search) {
    where.name = { [db.Sequelize.Op.like]: `%${search}%` };
  }

  const { count, rows } = await db.KnowledgeSources.findAndCountAll({
    where,
    order: [["deleted_at", "DESC"]],
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  return {
    totalItems: count,
    sources: rows,
    totalPages: Math.ceil(count / limit),
    currentPage: parseInt(page),
  };
};

/**
 * Restore a soft-deleted knowledge source
 */
export const restoreKnowledgeService = async (id, tenant_id) => {
  const source = await db.KnowledgeSources.findOne({
    where: { id, tenant_id, is_deleted: true }
  });

  if (!source) {
    throw new Error("Knowledge source not found or not deleted");
  }

  await source.update({
    is_deleted: false,
    deleted_at: null
  });

  return { message: "Knowledge source restored successfully" };
};
