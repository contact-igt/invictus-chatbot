/**
 * leads.lifecycle.js
 * CASCADE: leads — standalone (no children)
 */
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  annotateDeletedRows, isRestoreEligible,
  RestoreExpiredError, NotFoundError, lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchLead = async (leadId, tenant_id, t = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, lead_id, contact_id, score, heat_state, status, is_deleted, deleted_at
     FROM ${tableNames.LEADS}
     WHERE lead_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
    { replacements: [leadId, tenant_id], transaction: t },
  );
  return rows[0] || null;
};

export const softDeleteLead = async (leadId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchLead(leadId, tenant_id, t);
    if (!row) throw new NotFoundError("Lead not found");
    if (row.is_deleted) throw new Error("Lead is already deleted");
    await db.sequelize.query(
      `UPDATE ${tableNames.LEADS}
       SET is_deleted = true, deleted_at = NOW(), status = 'archived', updated_at = NOW()
       WHERE lead_id = ? AND tenant_id = ?`,
      { replacements: [leadId, tenant_id], transaction: t },
    );
  });
};

export const restoreLead = async (leadId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchLead(leadId, tenant_id, t);
    if (!row) throw new NotFoundError("Lead not found");
    if (!row.is_deleted) throw new Error("Lead is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();
    await db.sequelize.query(
      `UPDATE ${tableNames.LEADS}
       SET is_deleted = false, deleted_at = NULL, status = 'active', updated_at = NOW()
       WHERE lead_id = ? AND tenant_id = ?`,
      { replacements: [leadId, tenant_id], transaction: t },
    );
    return row;
  });
};

export const hardDeleteLead = async (leadId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchLead(leadId, tenant_id, t);
    if (!row) throw new NotFoundError("Lead not found");
    await db.sequelize.query(
      `DELETE FROM ${tableNames.LEADS} WHERE lead_id = ? AND tenant_id = ?`,
      { replacements: [leadId, tenant_id], transaction: t },
    );
  });
};

export const getDeletedLeads = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const [rows] = await db.sequelize.query(
    `SELECT l.lead_id, l.score, l.heat_state, l.source, l.priority,
            l.deleted_at, l.created_at,
            c.name AS contact_name, c.phone AS contact_phone
     FROM ${tableNames.LEADS} l
     LEFT JOIN ${tableNames.CONTACTS} c
       ON c.contact_id = l.contact_id AND c.tenant_id = l.tenant_id
     WHERE l.tenant_id = ? AND l.is_deleted = true
     ORDER BY l.deleted_at DESC LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );
  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.LEADS}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );
  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

export const softDeleteLeadController = lifecycleHandler(async (req, res) => {
  await softDeleteLead(req.params.lead_id, req.user.tenant_id);
  return res.status(200).json({ message: "Lead moved to trash" });
});
export const restoreLeadController = lifecycleHandler(async (req, res) => {
  const data = await restoreLead(req.params.lead_id, req.user.tenant_id);
  return res.status(200).json({ message: "Lead restored", data });
});
export const hardDeleteLeadController = lifecycleHandler(async (req, res) => {
  await hardDeleteLead(req.params.lead_id, req.user.tenant_id);
  return res.status(200).json({ message: "Lead permanently deleted" });
});
export const getDeletedLeadsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedLeads(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
