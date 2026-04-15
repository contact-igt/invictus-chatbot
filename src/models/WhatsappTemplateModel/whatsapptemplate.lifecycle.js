/**
 * whatsapptemplate.lifecycle.js
 *
 * CASCADE:
 *   whatsapp_templates
 *     └─ whatsapp_templates_components   hard-delete cascade
 *     └─ whatsapp_template_variables     hard-delete cascade
 *     └─ whatsapp_template_sync_logs     hard-delete cascade
 *
 * Note: whatsapp_campaign_recipients that used this template are NOT deleted.
 * Campaigns keep their historical template snapshot.
 */

import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  annotateDeletedRows,
  isRestoreEligible,
  RestoreExpiredError,
  NotFoundError,
  lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchTemplate = async (id, tenant_id, transaction = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, template_id, template_name, category, status, is_deleted, deleted_at
     FROM ${tableNames.WHATSAPP_TEMPLATE}
     WHERE template_id = ? AND tenant_id = ?
     LIMIT 1 FOR UPDATE`,
    { replacements: [id, tenant_id], transaction },
  );
  return rows[0] || null;
};

// ── Service: softDeleteTemplate ───────────────────────────────────────────────
export const softDeleteTemplate = async (templateId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchTemplate(templateId, tenant_id, t);
    if (!row) throw new NotFoundError("Template not found");
    if (row.is_deleted) throw new Error("Template is already deleted");

    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_TEMPLATE}
       SET is_deleted = true, deleted_at = NOW(), status = 'deleted', updated_at = NOW()
       WHERE template_id = ? AND tenant_id = ?`,
      { replacements: [templateId, tenant_id], transaction: t },
    );
  });
};

// ── Service: restoreTemplate ──────────────────────────────────────────────────
export const restoreTemplate = async (templateId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchTemplate(templateId, tenant_id, t);
    if (!row) throw new NotFoundError("Template not found");
    if (!row.is_deleted) throw new Error("Template is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();

    // Restore to 'paused' — requires re-submission to Meta for active status
    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_TEMPLATE}
       SET is_deleted = false, deleted_at = NULL, status = 'paused', updated_at = NOW()
       WHERE template_id = ? AND tenant_id = ?`,
      { replacements: [templateId, tenant_id], transaction: t },
    );

    return row;
  });
};

// ── Service: hardDeleteTemplate ───────────────────────────────────────────────
export const hardDeleteTemplate = async (templateId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchTemplate(templateId, tenant_id, t);
    if (!row) throw new NotFoundError("Template not found");

    // 1. Delete sync logs
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS}
       WHERE template_id = ?`,
      { replacements: [templateId], transaction: t },
    );

    // 2. Delete variables
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
       WHERE template_id = ?`,
      { replacements: [templateId], transaction: t },
    );

    // 3. Delete components
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
       WHERE template_id = ?`,
      { replacements: [templateId], transaction: t },
    );

    // 4. Delete parent
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE}
       WHERE template_id = ? AND tenant_id = ?`,
      { replacements: [templateId, tenant_id], transaction: t },
    );
  });
};

// ── Service: getDeletedTemplates ──────────────────────────────────────────────
export const getDeletedTemplates = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;

  const [rows] = await db.sequelize.query(
    `SELECT template_id, template_name, category, language, template_type,
            meta_template_name, deleted_at, created_at
     FROM ${tableNames.WHATSAPP_TEMPLATE}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC
     LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );

  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.WHATSAPP_TEMPLATE}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );

  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

// ── Controllers ───────────────────────────────────────────────────────────────

export const softDeleteTemplateController = lifecycleHandler(async (req, res) => {
  await softDeleteTemplate(req.params.template_id, req.user.tenant_id);
  return res.status(200).json({ message: "Template moved to trash" });
});

export const restoreTemplateController = lifecycleHandler(async (req, res) => {
  const data = await restoreTemplate(req.params.template_id, req.user.tenant_id);
  return res.status(200).json({ message: "Template restored — re-submit to Meta to reactivate", data });
});

export const hardDeleteTemplateController = lifecycleHandler(async (req, res) => {
  await hardDeleteTemplate(req.params.template_id, req.user.tenant_id);
  return res.status(200).json({ message: "Template permanently deleted" });
});

export const getDeletedTemplatesController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedTemplates(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
