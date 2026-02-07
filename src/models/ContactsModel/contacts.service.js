import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";

export const createContactService = async (
  tenant_id,
  phone,
  name,
  profile_pic,
  wa_id = null,
  email = null,
) => {
  try {
    // Generate contact_id
    const contact_id = await generateReadableIdFromLast(
      tableNames.CONTACTS,
      "contact_id",
      "CNT",
      5
    );

    const Query = `
    INSERT INTO ${tableNames?.CONTACTS} 
    (contact_id, tenant_id, phone, name, profile_pic, wa_id, email, is_blocked, last_message_at) 
    VALUES (?,?,?,?,?,?,?,?,NOW())`;

    const Values = [contact_id, tenant_id, phone, name, profile_pic, wa_id, email, false];

    const [result] = await db.sequelize.query(Query, { replacements: Values });
    return { contact_id, id: result };
  } catch (err) {
    throw err;
  }
};

export const getContactByPhoneAndTenantIdService = async (tenant_id, phone) => {
  try {
    const Values = [tenant_id, phone];

    const Query = `SELECT * FROM ${tableNames?.CONTACTS} WHERE tenant_id = ? AND phone = ? AND is_deleted = false LIMIT 1 `;

    const [result] = await db.sequelize.query(Query, { replacements: Values });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getContactByIdAndTenantIdService = async (id, tenant_id) => {
  try {
    const Values = [id, tenant_id];

    const Query = `SELECT * FROM ${tableNames?.CONTACTS} WHERE id = ? AND tenant_id = ? AND is_deleted = false LIMIT 1 `;

    const [result] = await db.sequelize.query(Query, { replacements: Values });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getContactByContactIdAndTenantIdService = async (contact_id, tenant_id) => {
  try {
    const Values = [contact_id, tenant_id];

    const Query = `SELECT * FROM ${tableNames?.CONTACTS} WHERE contact_id = ? AND tenant_id = ? AND is_deleted = false LIMIT 1 `;

    const [result] = await db.sequelize.query(Query, { replacements: Values });

    return result[0];
  } catch (err) {
    throw err;
  }
};

export const getAllContactsService = async (tenant_id) => {
  try {
    const Query = `SELECT * FROM ${tableNames?.CONTACTS} WHERE tenant_id IN (?) AND is_deleted = false ORDER BY id DESC`;

    const [result] = await db.sequelize.query(Query, {
      replacements: [tenant_id],
    });
    return result;
  } catch (err) {
    throw err;
  }
};

export const updateContactService = async (
  contact_id,
  tenant_id,
  name,
  email,
  profile_pic,
  is_blocked
) => {
  const Query = `
  UPDATE ${tableNames?.CONTACTS} 
  SET name = ?, email = ?, profile_pic = ?, is_blocked = ?
  WHERE contact_id = ? AND tenant_id = ?`;

  try {
    const Values = [name, email, profile_pic, is_blocked, contact_id, tenant_id];

    const [result] = await db.sequelize.query(Query, { replacements: Values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteContactService = async (id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    const Query1 = `UPDATE ${tableNames?.CONTACTS} SET is_deleted = true, deleted_at = NOW() WHERE id = ? AND tenant_id = ?`;
    const Query2 = `UPDATE ${tableNames?.LEADS} SET is_deleted = true, deleted_at = NOW() WHERE contact_id = ? AND tenant_id = ?`;

    await db.sequelize.query(Query1, {
      replacements: [id, tenant_id],
      transaction,
    });
    await db.sequelize.query(Query2, {
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

export const permanentDeleteContactService = async (id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    // 1. Delete Messages
    await db.sequelize.query(`DELETE FROM ${tableNames.MESSAGES} WHERE contact_id = ? AND tenant_id = ?`, {
      replacements: [id, tenant_id],
      transaction,
    });

    // 2. Delete Live Chat
    await db.sequelize.query(`DELETE FROM ${tableNames.LIVECHAT} WHERE contact_id = ? AND tenant_id = ?`, {
      replacements: [id, tenant_id],
      transaction,
    });

    // 3. Delete Leads
    await db.sequelize.query(`DELETE FROM ${tableNames.LEADS} WHERE contact_id = ? AND tenant_id = ?`, {
      replacements: [id, tenant_id],
      transaction,
    });

    // 4. Delete Contact
    await db.sequelize.query(`DELETE FROM ${tableNames.CONTACTS} WHERE id = ? AND tenant_id = ?`, {
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

/**
 * Retrieves a list of soft-deleted contacts for a tenant.
 */
export const getDeletedContactListService = async (tenant_id, query) => {
  const { search, page = 1, limit = 10 } = query;
  const offset = (page - 1) * limit;

  let where = { tenant_id, is_deleted: true };
  if (search) {
    where[db.Sequelize.Op.or] = [
      { name: { [db.Sequelize.Op.like]: `%${search}%` } },
      { phone: { [db.Sequelize.Op.like]: `%${search}%` } },
      { email: { [db.Sequelize.Op.like]: `%${search}%` } },
    ];
  }

  const { count, rows } = await db.Contacts.findAndCountAll({
    where,
    order: [["deleted_at", "DESC"]],
    limit: parseInt(limit),
    offset: parseInt(offset),
  });

  return {
    totalItems: count,
    contacts: rows,
    totalPages: Math.ceil(count / limit),
    currentPage: parseInt(page),
  };
};

/**
 * Restore a soft-deleted contact
 */
export const restoreContactService = async (id, tenant_id) => {
  const contact = await db.Contacts.findOne({
    where: { id, tenant_id, is_deleted: true }
  });

  if (!contact) {
    throw new Error("Contact not found or not deleted");
  }

  await contact.update({
    is_deleted: false,
    deleted_at: null
  });

  return { message: "Contact restored successfully" };
};
