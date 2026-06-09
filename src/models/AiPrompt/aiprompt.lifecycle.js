/**
 * aiprompt.lifecycle.js
 * CASCADE: ai_prompts — standalone (no children)
 */
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  annotateDeletedRows, isRestoreEligible,
  RestoreExpiredError, NotFoundError, lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchPrompt = async (id, tenant_id, t = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, name, is_active, is_deleted, deleted_at
     FROM ${tableNames.AIPROMPT}
     WHERE id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
    { replacements: [id, tenant_id], transaction: t },
  );
  return rows[0] || null;
};

export const softDeleteAiPrompt = async (id, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchPrompt(id, tenant_id, t);
    if (!row) throw new NotFoundError("AI prompt not found");
    if (row.is_deleted) throw new Error("Prompt is already deleted");
    await db.sequelize.query(
      `UPDATE ${tableNames.AIPROMPT}
       SET is_deleted = true, deleted_at = NOW(), is_active = false, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );
  });
};

export const restoreAiPrompt = async (id, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchPrompt(id, tenant_id, t);
    if (!row) throw new NotFoundError("AI prompt not found");
    if (!row.is_deleted) throw new Error("Prompt is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();
    await db.sequelize.query(
      `UPDATE ${tableNames.AIPROMPT}
       SET is_deleted = false, deleted_at = NULL, is_active = true, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );
    return row;
  });
};

export const hardDeleteAiPrompt = async (id, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchPrompt(id, tenant_id, t);
    if (!row) throw new NotFoundError("AI prompt not found");
    await db.sequelize.query(
      `DELETE FROM ${tableNames.AIPROMPT} WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );
  });
};

export const getDeletedAiPrompts = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const [rows] = await db.sequelize.query(
    `SELECT id, name, deleted_at, created_at
     FROM ${tableNames.AIPROMPT}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );
  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.AIPROMPT}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );
  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

export const softDeleteAiPromptController = lifecycleHandler(async (req, res) => {
  await softDeleteAiPrompt(req.params.id, req.user.tenant_id);
  return res.status(200).json({ message: "AI prompt moved to trash" });
});
export const restoreAiPromptController = lifecycleHandler(async (req, res) => {
  const data = await restoreAiPrompt(req.params.id, req.user.tenant_id);
  return res.status(200).json({ message: "AI prompt restored", data });
});
export const hardDeleteAiPromptController = lifecycleHandler(async (req, res) => {
  await hardDeleteAiPrompt(req.params.id, req.user.tenant_id);
  return res.status(200).json({ message: "AI prompt permanently deleted" });
});
export const getDeletedAiPromptsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedAiPrompts(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
