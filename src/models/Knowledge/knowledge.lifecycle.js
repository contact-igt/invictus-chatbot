/**
 * knowledge.lifecycle.js
 *
 * Soft-delete → Restore → Hard-delete lifecycle for knowledge_sources.
 *
 * CASCADE:
 *   knowledge_sources
 *     └─ knowledge_chunks       hard-delete on parent hard-delete; soft-clear on soft-delete
 *
 * Embeddings must be rebuilt after restore (chunks were deleted on soft-delete).
 * The physical chunk rebuild is handled by knowledge.service.js processKnowledgeUpload
 * or by calling syncKnowledgeChunks() below.
 */

import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { chunkText } from "../../utils/text/chunkText.js";
import { generateTextEmbedding } from "../../utils/ai/embedding.js";
import {
  annotateDeletedRows,
  daysRemaining,
  isRestoreEligible,
  RestoreExpiredError,
  NotFoundError,
  lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

// ── Internal helpers ──────────────────────────────────────────────────────────

const fetchSource = async (id, tenant_id, transaction = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, title, type, raw_text, status, is_deleted, deleted_at
     FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE id = ? AND tenant_id = ?
     LIMIT 1 FOR UPDATE`,
    { replacements: [id, tenant_id], transaction },
  );
  return rows[0] || null;
};

// Rebuild knowledge chunks for a source (called OUTSIDE transaction)
const rebuildChunks = async (tenant_id, source_id, raw_text) => {
  if (!raw_text?.trim()) return;

  await db.sequelize.query(
    `DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
     WHERE tenant_id = ? AND source_id = ?`,
    { replacements: [tenant_id, source_id] },
  );

  const chunks = chunkText(raw_text);
  for (const chunk of chunks) {
    const embedding = await generateTextEmbedding(chunk, tenant_id);
    await db.sequelize.query(
      `INSERT INTO ${tableNames.KNOWLEDGECHUNKS}
         (tenant_id, source_id, chunk_text, embedding, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, false, NOW(), NOW())`,
      { replacements: [tenant_id, source_id, chunk, JSON.stringify(embedding || [])] },
    );
  }
};

// ── Service: softDeleteKnowledgeSource ───────────────────────────────────────
export const softDeleteKnowledgeSource = async (id, tenant_id) => {
  await db.sequelize.transaction(async (t) => {
    const row = await fetchSource(id, tenant_id, t);
    if (!row) throw new NotFoundError("Knowledge source not found");
    if (row.is_deleted) throw new Error("Knowledge source is already deleted");

    // Soft-delete the parent
    await db.sequelize.query(
      `UPDATE ${tableNames.KNOWLEDGESOURCE}
       SET is_deleted = true, deleted_at = NOW(), status = 'inactive', updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );

    // Hard-delete chunks immediately — they are worthless and expensive to store
    await db.sequelize.query(
      `DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
       WHERE tenant_id = ? AND source_id = ?`,
      { replacements: [tenant_id, id], transaction: t },
    );
  });
};

// ── Service: restoreKnowledgeSource ──────────────────────────────────────────
export const restoreKnowledgeSource = async (id, tenant_id) => {
  let restoredRow = null;

  await db.sequelize.transaction(async (t) => {
    const row = await fetchSource(id, tenant_id, t);
    if (!row) throw new NotFoundError("Knowledge source not found");
    if (!row.is_deleted) throw new Error("Knowledge source is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();

    await db.sequelize.query(
      `UPDATE ${tableNames.KNOWLEDGESOURCE}
       SET is_deleted = false, deleted_at = NULL, status = 'active', updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );

    restoredRow = { ...row, raw_text: row.raw_text };
  });

  // Phase 2: rebuild embeddings outside transaction (may be slow for large sources)
  if (restoredRow?.raw_text) {
    await rebuildChunks(tenant_id, id, restoredRow.raw_text);
  }

  return restoredRow;
};

// ── Service: hardDeleteKnowledgeSource ───────────────────────────────────────
export const hardDeleteKnowledgeSource = async (id, tenant_id) => {
  await db.sequelize.transaction(async (t) => {
    const row = await fetchSource(id, tenant_id, t);
    if (!row) throw new NotFoundError("Knowledge source not found");

    // 1. Delete chunks first
    await db.sequelize.query(
      `DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
       WHERE tenant_id = ? AND source_id = ?`,
      { replacements: [tenant_id, id], transaction: t },
    );

    // 2. Delete parent
    await db.sequelize.query(
      `DELETE FROM ${tableNames.KNOWLEDGESOURCE}
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );
  });
};

// ── Service: getDeletedKnowledgeSources ──────────────────────────────────────
export const getDeletedKnowledgeSources = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;

  const [rows] = await db.sequelize.query(
    `SELECT id, title, type, file_name, source_url, deleted_at, created_at
     FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC
     LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );

  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );

  return {
    items: annotateDeletedRows(rows),
    total: Number(total),
    page,
    limit,
  };
};

// ── Controllers ───────────────────────────────────────────────────────────────

export const softDeleteKnowledgeSourceController = lifecycleHandler(async (req, res) => {
  const { id } = req.params;
  const { tenant_id } = req.user;
  await softDeleteKnowledgeSource(id, tenant_id);
  return res.status(200).json({ message: "Knowledge source moved to trash" });
});

export const restoreKnowledgeSourceController = lifecycleHandler(async (req, res) => {
  const { id } = req.params;
  const { tenant_id } = req.user;
  const data = await restoreKnowledgeSource(id, tenant_id);
  return res.status(200).json({ message: "Knowledge source restored and embeddings rebuilt", data });
});

export const hardDeleteKnowledgeSourceController = lifecycleHandler(async (req, res) => {
  const { id } = req.params;
  const { tenant_id } = req.user;
  await hardDeleteKnowledgeSource(id, tenant_id);
  return res.status(200).json({ message: "Knowledge source permanently deleted" });
});

export const getDeletedKnowledgeSourcesController = lifecycleHandler(async (req, res) => {
  const { tenant_id } = req.user;
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedKnowledgeSources(tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
