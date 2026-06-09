/**
 * contacts.lifecycle.js
 *
 * CASCADE on soft-delete:
 *   contacts
 *     └─ contact_group_members    hard-delete immediately (no restore value)
 *     └─ leads                    soft-delete cascade
 *     └─ live_chats               soft-delete cascade
 *     └─ messages                 soft-delete cascade (retain history, exclude from queries)
 *     └─ appointments             soft-delete cascade
 *     └─ booking_sessions         SET status='cancelled'
 *
 * CASCADE on restore:
 *   contacts — only the contact itself is restored.
 *   Children retain their own lifecycle states (no auto-restore).
 *
 * CASCADE on hard-delete:
 *   All children hard-deleted first, then parent.
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

const fetchContact = async (contactId, tenant_id, transaction = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, contact_id, name, phone, wa_id, is_deleted, deleted_at
     FROM ${tableNames.CONTACTS}
     WHERE contact_id = ? AND tenant_id = ?
     LIMIT 1 FOR UPDATE`,
    { replacements: [contactId, tenant_id], transaction },
  );
  return rows[0] || null;
};

// ── Service: softDeleteContact ────────────────────────────────────────────────
export const softDeleteContact = async (contactId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchContact(contactId, tenant_id, t);
    if (!row) throw new NotFoundError("Contact not found");
    if (row.is_deleted) throw new Error("Contact is already deleted");

    const internalId = row.id;

    // 1. Soft-delete the contact
    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACTS}
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    // 2. Hard-delete group memberships (no restore value)
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACT_GROUP_MEMBERS}
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    // 3. Soft-delete leads
    await db.sequelize.query(
      `UPDATE ${tableNames.LEADS}
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE contact_id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    // 4. Soft-delete live chats
    await db.sequelize.query(
      `UPDATE ${tableNames.LIVECHAT}
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE contact_id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    // 5. Soft-delete messages (retain history in trash)
    await db.sequelize.query(
      `UPDATE ${tableNames.MESSAGES}
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE contact_id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    // 6. Soft-delete appointments
    await db.sequelize.query(
      `UPDATE ${tableNames.APPOINTMENTS}
       SET is_deleted = true, deleted_at = NOW(), updated_at = NOW()
       WHERE contact_id = ? AND tenant_id = ? AND is_deleted = false`,
      { replacements: [internalId, tenant_id], transaction: t },
    );

    // 7. Cancel active booking sessions
    await db.sequelize.query(
      `UPDATE ${tableNames.BOOKING_SESSIONS}
       SET status = 'cancelled', updated_at = NOW()
       WHERE contact_id = ? AND tenant_id = ? AND status = 'active'`,
      { replacements: [contactId, tenant_id], transaction: t },
    );
  });
};

// ── Service: restoreContact ───────────────────────────────────────────────────
// Only the contact itself is restored — children keep their own lifecycle states.
export const restoreContact = async (contactId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchContact(contactId, tenant_id, t);
    if (!row) throw new NotFoundError("Contact not found");
    if (!row.is_deleted) throw new Error("Contact is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();

    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACTS}
       SET is_deleted = false, deleted_at = NULL, updated_at = NOW()
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    return row;
  });
};

// ── Service: hardDeleteContact ────────────────────────────────────────────────
export const hardDeleteContact = async (contactId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchContact(contactId, tenant_id, t);
    if (!row) throw new NotFoundError("Contact not found");

    const internalId = row.id;

    // Delete in leaf → parent order
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACT_GROUP_MEMBERS}
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    await db.sequelize.query(
      `DELETE FROM ${tableNames.BOOKING_SESSIONS}
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    await db.sequelize.query(
      `DELETE FROM ${tableNames.MESSAGES}
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    await db.sequelize.query(
      `DELETE FROM ${tableNames.LIVECHAT}
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    await db.sequelize.query(
      `DELETE FROM ${tableNames.LEADS}
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );

    await db.sequelize.query(
      `DELETE FROM ${tableNames.APPOINTMENTS}
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [internalId, tenant_id], transaction: t },
    );

    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACTS}
       WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [contactId, tenant_id], transaction: t },
    );
  });
};

// ── Service: getDeletedContacts ───────────────────────────────────────────────
export const getDeletedContacts = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;

  const [rows] = await db.sequelize.query(
    `SELECT contact_id, name, phone, country_code, wa_id, email,
            deleted_at, created_at
     FROM ${tableNames.CONTACTS}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC
     LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );

  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.CONTACTS}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );

  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

// ── Controllers ───────────────────────────────────────────────────────────────

export const softDeleteContactController = lifecycleHandler(async (req, res) => {
  await softDeleteContact(req.params.contact_id, req.user.tenant_id);
  return res.status(200).json({ message: "Contact moved to trash" });
});

export const restoreContactController = lifecycleHandler(async (req, res) => {
  const data = await restoreContact(req.params.contact_id, req.user.tenant_id);
  return res.status(200).json({ message: "Contact restored", data });
});

export const hardDeleteContactController = lifecycleHandler(async (req, res) => {
  await hardDeleteContact(req.params.contact_id, req.user.tenant_id);
  return res.status(200).json({
    message: "Contact and all related records permanently deleted",
  });
});

export const getDeletedContactsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedContacts(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
