/**
 * contactgroup.lifecycle.js
 * CASCADE: contact_groups → contact_group_members (hard-delete)
 */
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  annotateDeletedRows, isRestoreEligible,
  RestoreExpiredError, NotFoundError, lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchGroup = async (groupId, tenant_id, t = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, group_id, group_name, is_deleted, deleted_at
     FROM ${tableNames.CONTACT_GROUPS}
     WHERE group_id = ? AND tenant_id = ? LIMIT 1 FOR UPDATE`,
    { replacements: [groupId, tenant_id], transaction: t },
  );
  return rows[0] || null;
};

export const softDeleteContactGroup = async (groupId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchGroup(groupId, tenant_id, t);
    if (!row) throw new NotFoundError("Contact group not found");
    if (row.is_deleted) throw new Error("Group is already deleted");
    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACT_GROUPS}
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE group_id = ? AND tenant_id = ?`,
      { replacements: [groupId, tenant_id], transaction: t },
    );
    // Hard-delete memberships — no value without the group
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACT_GROUP_MEMBERS}
       WHERE group_id = ? AND tenant_id = ?`,
      { replacements: [groupId, tenant_id], transaction: t },
    );
  });
};

export const restoreContactGroup = async (groupId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchGroup(groupId, tenant_id, t);
    if (!row) throw new NotFoundError("Contact group not found");
    if (!row.is_deleted) throw new Error("Group is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();
    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACT_GROUPS}
       SET is_deleted = false, deleted_at = NULL, updated_at = NOW()
       WHERE group_id = ? AND tenant_id = ?`,
      { replacements: [groupId, tenant_id], transaction: t },
    );
    return row;
  });
};

export const hardDeleteContactGroup = async (groupId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchGroup(groupId, tenant_id, t);
    if (!row) throw new NotFoundError("Contact group not found");
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACT_GROUP_MEMBERS} WHERE group_id = ? AND tenant_id = ?`,
      { replacements: [groupId, tenant_id], transaction: t },
    );
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACT_GROUPS} WHERE group_id = ? AND tenant_id = ?`,
      { replacements: [groupId, tenant_id], transaction: t },
    );
  });
};

export const getDeletedContactGroups = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;
  const [rows] = await db.sequelize.query(
    `SELECT group_id, group_name, description, deleted_at, created_at
     FROM ${tableNames.CONTACT_GROUPS}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );
  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.CONTACT_GROUPS}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );
  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

export const softDeleteContactGroupController = lifecycleHandler(async (req, res) => {
  await softDeleteContactGroup(req.params.group_id, req.user.tenant_id);
  return res.status(200).json({ message: "Contact group moved to trash" });
});
export const restoreContactGroupController = lifecycleHandler(async (req, res) => {
  const data = await restoreContactGroup(req.params.group_id, req.user.tenant_id);
  return res.status(200).json({ message: "Contact group restored", data });
});
export const hardDeleteContactGroupController = lifecycleHandler(async (req, res) => {
  await hardDeleteContactGroup(req.params.group_id, req.user.tenant_id);
  return res.status(200).json({ message: "Contact group permanently deleted" });
});
export const getDeletedContactGroupsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedContactGroups(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
