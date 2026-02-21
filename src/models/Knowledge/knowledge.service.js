import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { chunkText } from "../../utils/text/chunkText.js";
import { cleanText } from "../../utils/text/cleanText.js";

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
  const dataQuery = `
    SELECT id, title, type, source_url, file_name, status, created_at
    FROM ${tableNames.KNOWLEDGESOURCE}
    WHERE tenant_id = ? AND is_deleted = false
    ORDER BY created_at DESC
  `;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    return {
      sources: rows,
    };
  } catch (err) {
    throw err;
  }
};

export const getKnowledgeByIdService = async (id, tenant_id) => {
  try {
    const [rows] = await db.sequelize.query(
      `
    SELECT *
    FROM ${tableNames.KNOWLEDGESOURCE}
    WHERE id = ? AND tenant_id = ? AND is_deleted = false
    `,
      { replacements: [id, tenant_id] },
    );
    return rows[0];
  } catch (err) {
    throw err;
  }
};

export const updateKnowledgeService = async (id, tenant_id, title, text) => {
  const cleaned = cleanText(text);

  try {
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
  } catch (err) {
    throw err;
  }
};

export const deleteKnowledgeService = async (id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    // Soft delete chunks first (so they don't appear in AI responses)
    await db.sequelize.query(
      `UPDATE ${tableNames.KNOWLEDGECHUNKS}
       SET is_deleted = true, deleted_at = NOW()
       WHERE source_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction }
    );

    // Then soft delete the source
    await db.sequelize.query(
      `UPDATE ${tableNames.KNOWLEDGESOURCE}
       SET is_deleted = true, deleted_at = NOW()
       WHERE id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [id, tenant_id], transaction }
    );

    await transaction.commit();
    return { message: "Knowledge source deleted successfully" };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
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
/**
 * Retrieves a list of soft-deleted knowledge sources for a tenant.
 */
export const getDeletedKnowledgeListService = async (tenant_id) => {
  try {
    const where = { tenant_id, is_deleted: true };

    const { count, rows } = await db.KnowledgeSources.findAndCountAll({
      where,
      order: [["deleted_at", "DESC"]],
    });

    return {
      sources: rows,
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Restore a soft-deleted knowledge source
 */
/**
 * Restore a soft-deleted knowledge source
 */
export const restoreKnowledgeService = async (id, tenant_id) => {
  try {
    const source = await db.KnowledgeSources.findOne({
      where: { id, tenant_id, is_deleted: true }
    });

    if (!source) {
      throw new Error("Knowledge source not found or not deleted");
    }

    // Use raw query to avoid ON UPDATE CURRENT_TIMESTAMP conflict
    await db.sequelize.query(
      `UPDATE ${tableNames.KNOWLEDGESOURCE} 
     SET is_deleted = false, deleted_at = NULL 
     WHERE id = ? AND tenant_id = ?`,
      {
        replacements: [id, tenant_id],
        type: db.Sequelize.QueryTypes.UPDATE
      }
    );

    return { message: "Knowledge source restored successfully" };
  } catch (err) {
    throw err;
  }
};
