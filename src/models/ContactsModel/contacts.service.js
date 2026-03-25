import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";

export const createContactService = async (
  tenant_id,
  phoneInput,
  name,
  profile_pic,
  countryCodeInput = null,
  wa_id = null,
  email = null,
) => {
  try {
    let country_code = countryCodeInput;
    let phone = phoneInput;

    // Auto-split if country_code is missing but phone is combined (e.g. 919876543210)
    if (!country_code && phone && phone.length > 10) {
      country_code = `+${phone.slice(0, -10)}`;
      phone = phone.slice(-10);
    } else if (country_code && !country_code.startsWith("+")) {
      country_code = `+${country_code.replace(/\D/g, "")}`;
    }

    // Generate contact_id
    const contact_id = await generateReadableIdFromLast(
      tableNames.CONTACTS,
      "contact_id",
      "CNT",
      5,
    );

    const Query = `
    INSERT INTO ${tableNames?.CONTACTS} 
    (contact_id, tenant_id, country_code, phone, name, profile_pic, wa_id, email, is_blocked, last_message_at) 
    VALUES (?,?,?,?,?,?,?,?,?,NOW())`;

    const Values = [
      contact_id || null,
      tenant_id || null,
      country_code || null,
      phone || null,
      name || null,
      profile_pic || null,
      wa_id || null,
      email || null,
      false,
    ];

    const [result] = await db.sequelize.query(Query, { replacements: Values });
    return { contact_id, id: result };
  } catch (err) {
    throw err;
  }
};

/**
 * Atomically get or create a contact to prevent duplicate contacts from race conditions.
 * Uses INSERT IGNORE + SELECT for thread-safety.
 */
export const getOrCreateContactService = async (
  tenant_id,
  phoneInput,
  name,
  profile_pic = null,
  countryCodeInput = null,
) => {
  try {
    let country_code = countryCodeInput;
    let phone = phoneInput ? phoneInput.toString().replace(/\D/g, "") : "";

    // Auto-split if country_code is missing but phone is combined (e.g. 919876543210)
    if (!country_code && phone && phone.length > 10) {
      country_code = `+${phone.slice(0, -10)}`;
      phone = phone.slice(-10);
    } else if (country_code && !country_code.startsWith("+")) {
      country_code = `+${country_code.replace(/\D/g, "")}`;
    }

    // First try to get existing active contact
    const existingQuery = `
      SELECT * FROM ${tableNames.CONTACTS} 
      WHERE tenant_id = ? AND phone = ? AND is_deleted = false 
      LIMIT 1 FOR UPDATE
    `;

    // Use transaction to prevent race conditions
    const result = await db.sequelize.transaction(async (t) => {
      // Check for existing contact (with row lock)
      const [existing] = await db.sequelize.query(existingQuery, {
        replacements: [tenant_id, phone],
        transaction: t,
      });

      if (existing[0]) {
        return { contact: existing[0], created: false };
      }

      // Check for soft-deleted contact to restore
      const [deleted] = await db.sequelize.query(
        `SELECT * FROM ${tableNames.CONTACTS} WHERE tenant_id = ? AND phone = ? AND is_deleted = true LIMIT 1 FOR UPDATE`,
        { replacements: [tenant_id, phone], transaction: t },
      );

      if (deleted[0]) {
        // Restore the deleted contact
        await db.sequelize.query(
          `UPDATE ${tableNames.CONTACTS} SET is_deleted = false, deleted_at = NULL, name = COALESCE(?, name) WHERE contact_id = ?`,
          { replacements: [name, deleted[0].contact_id], transaction: t },
        );
        await db.sequelize.query(
          `UPDATE ${tableNames.LEADS} SET is_deleted = false, deleted_at = NULL WHERE contact_id = ? AND tenant_id = ?`,
          { replacements: [deleted[0].contact_id, tenant_id], transaction: t },
        );
        deleted[0].is_deleted = false;
        deleted[0].name = name || deleted[0].name;
        return { contact: deleted[0], created: false, restored: true };
      }

      // Create new contact
      const contact_id = await generateReadableIdFromLast(
        tableNames.CONTACTS,
        "contact_id",
        "CNT",
        5,
      );

      await db.sequelize.query(
        `INSERT INTO ${tableNames.CONTACTS} 
         (contact_id, tenant_id, country_code, phone, name, profile_pic, is_blocked, last_message_at) 
         VALUES (?, ?, ?, ?, ?, ?, false, NOW())`,
        {
          replacements: [
            contact_id,
            tenant_id,
            country_code,
            phone,
            name,
            profile_pic,
          ],
          transaction: t,
        },
      );

      // Fetch the newly created contact
      const [newContact] = await db.sequelize.query(
        `SELECT * FROM ${tableNames.CONTACTS} WHERE contact_id = ? LIMIT 1`,
        { replacements: [contact_id], transaction: t },
      );

      return { contact: newContact[0], created: true };
    });

    return result;
  } catch (err) {
    // If we hit a duplicate key error, the contact was created by another thread
    // Just fetch and return it
    if (
      err.message?.includes("Duplicate") ||
      err.original?.code === "ER_DUP_ENTRY"
    ) {
      const [existing] = await db.sequelize.query(
        `SELECT * FROM ${tableNames.CONTACTS} WHERE tenant_id = ? AND phone = ? AND is_deleted = false LIMIT 1`,
        {
          replacements: [
            tenant_id,
            phoneInput?.toString().replace(/\D/g, "").slice(-10),
          ],
        },
      );
      if (existing[0]) {
        return { contact: existing[0], created: false };
      }
    }
    throw err;
  }
};

export const getContactByPhoneAndTenantIdService = async (
  tenant_id,
  phoneInput,
  countryCodeInput = null,
) => {
  try {
    let phone = phoneInput ? phoneInput.toString().replace(/\D/g, "") : "";
    let country_code = countryCodeInput;

    // Auto-split combined webhook strings (e.g. 919876543210) into country_code and phone
    if (!country_code && phone.length > 10) {
      country_code = `+${phone.slice(0, -10)}`;
      phone = phone.slice(-10);
    } else if (country_code && !country_code.startsWith("+")) {
      country_code = `+${country_code.replace(/\D/g, "")}`;
    }

    const ccClause = country_code ? "AND country_code = ?" : "";
    const ccReplacements = country_code ? [country_code] : [];

    const Values = [tenant_id, phone, ...ccReplacements];

    // First, try to find active contact
    const activeQuery = `SELECT * FROM ${tableNames?.CONTACTS} WHERE tenant_id = ? AND phone = ? ${ccClause} AND is_deleted = false LIMIT 1`;
    const [activeResult] = await db.sequelize.query(activeQuery, {
      replacements: Values,
    });

    if (activeResult[0]) {
      return activeResult[0];
    }

    // fallback: match by last 10 digits if strict match fails (ignoring country code)
    if (phone && phone.length >= 10) {
      const suffix = phone.slice(-10);
      const suffixQuery = `SELECT * FROM ${tableNames?.CONTACTS} WHERE tenant_id = ? AND phone LIKE ? AND is_deleted = false LIMIT 1`;
      const [suffixResult] = await db.sequelize.query(suffixQuery, {
        replacements: [tenant_id, `%${suffix}`],
      });
      if (suffixResult[0]) {
        return suffixResult[0];
      }
    }

    // If no active contact, check for deleted contact
    const deletedQuery = `SELECT * FROM ${tableNames?.CONTACTS} WHERE tenant_id = ? AND phone = ? ${ccClause} AND is_deleted = true LIMIT 1`;
    const [deletedResult] = await db.sequelize.query(deletedQuery, {
      replacements: Values,
    });

    if (deletedResult[0]) {
      // Auto-restore the deleted contact to preserve chat history
      const contact_id = deletedResult[0].contact_id;

      // Restore contact
      await db.sequelize.query(
        `UPDATE ${tableNames.CONTACTS} SET is_deleted = false, deleted_at = NULL WHERE contact_id = ? AND tenant_id = ?`,
        { replacements: [contact_id, tenant_id] },
      );

      // Restore related leads
      await db.sequelize.query(
        `UPDATE ${tableNames.LEADS} SET is_deleted = false, deleted_at = NULL WHERE contact_id = ? AND tenant_id = ?`,
        { replacements: [contact_id, tenant_id] },
      );

      console.log(
        `[AUTO-RESTORE] Contact ${contact_id} auto-restored for tenant ${tenant_id}`,
      );

      // Return the restored contact
      deletedResult[0].is_deleted = false;
      deletedResult[0].deleted_at = null;
      return deletedResult[0];
    }

    return null;
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

// Trigger restart
export const getContactByContactIdAndTenantIdService = async (
  contact_id,
  tenant_id,
) => {
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
  const dataQuery = `
    SELECT *
    FROM ${tableNames.CONTACTS}
    WHERE tenant_id = ? AND is_deleted = false
    ORDER BY id DESC
  `;

  try {
    const [rows] = await db.sequelize.query(dataQuery, {
      replacements: [tenant_id],
    });

    return {
      contacts: rows,
    };
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
  is_blocked,
) => {
  const Query = `
  UPDATE ${tableNames?.CONTACTS} 
  SET name = ?, email = ?, profile_pic = ?, is_blocked = ?
  WHERE contact_id = ? AND tenant_id = ?`;

  try {
    const Values = [
      name,
      email,
      profile_pic,
      is_blocked,
      contact_id,
      tenant_id,
    ];

    const [result] = await db.sequelize.query(Query, { replacements: Values });
    return result;
  } catch (err) {
    throw err;
  }
};

export const deleteContactService = async (id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    // Soft delete contact
    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACTS} SET is_deleted = true, deleted_at = NOW() WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction },
    );

    // Soft delete related leads
    await db.sequelize.query(
      `UPDATE ${tableNames.LEADS} SET is_deleted = true, deleted_at = NOW() WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction },
    );

    // Soft delete messages
    await db.sequelize.query(
      `UPDATE ${tableNames.MESSAGES} SET is_deleted = true, deleted_at = NOW() WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction },
    );

    // Soft delete live chat
    await db.sequelize.query(
      `UPDATE ${tableNames.LIVECHAT} SET is_deleted = true, deleted_at = NOW() WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction },
    );

    // Hard delete group memberships (junction table - no soft delete needed)
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACT_GROUP_MEMBERS} WHERE contact_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction },
    );

    await transaction.commit();
    return { message: "Contact and all related data deleted successfully" };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const permanentDeleteContactService = async (id, tenant_id) => {
  const transaction = await db.sequelize.transaction();
  try {
    // 1. Delete Messages
    await db.sequelize.query(
      `DELETE FROM ${tableNames.MESSAGES} WHERE contact_id = ? AND tenant_id = ?`,
      {
        replacements: [id, tenant_id],
        transaction,
      },
    );

    // 2. Delete Live Chat
    await db.sequelize.query(
      `DELETE FROM ${tableNames.LIVECHAT} WHERE contact_id = ? AND tenant_id = ?`,
      {
        replacements: [id, tenant_id],
        transaction,
      },
    );

    // 3. Delete Leads
    await db.sequelize.query(
      `DELETE FROM ${tableNames.LEADS} WHERE contact_id = ? AND tenant_id = ?`,
      {
        replacements: [id, tenant_id],
        transaction,
      },
    );

    // 4. Delete Contact
    await db.sequelize.query(
      `DELETE FROM ${tableNames.CONTACTS} WHERE contact_id = ? AND tenant_id = ?`,
      {
        replacements: [id, tenant_id],
        transaction,
      },
    );

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
export const getDeletedContactListService = async (tenant_id) => {
  try {
    const where = { tenant_id, is_deleted: true };

    const rows = await db.Contacts.findAll({
      where,
      order: [["deleted_at", "DESC"]],
    });

    return {
      contacts: rows,
    };
  } catch (err) {
    throw err;
  }
};

/**
 * Restore a soft-deleted contact and related leads
 */
export const restoreContactService = async (contact_id, tenant_id) => {
  const contact = await db.Contacts.findOne({
    where: { contact_id, tenant_id, is_deleted: true },
  });

  if (!contact) {
    throw new Error("Contact not found or not deleted");
  }

  const transaction = await db.sequelize.transaction();
  try {
    // Restore contact
    await db.sequelize.query(
      `UPDATE ${tableNames.CONTACTS} 
       SET is_deleted = false, deleted_at = NULL 
       WHERE contact_id = ? AND tenant_id = ?`,
      {
        replacements: [contact_id, tenant_id],
        transaction,
        type: db.Sequelize.QueryTypes.UPDATE,
      },
    );

    // Restore related leads
    await db.sequelize.query(
      `UPDATE ${tableNames.LEADS} 
       SET is_deleted = false, deleted_at = NULL 
       WHERE contact_id = ? AND tenant_id = ?`,
      {
        replacements: [contact_id, tenant_id],
        transaction,
        type: db.Sequelize.QueryTypes.UPDATE,
      },
    );

    await transaction.commit();
    return { message: "Contact and leads restored successfully" };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

/**
 * Bulk import contacts from an array of objects
 * @param {string} tenant_id
 * @param {Array<{name: string, phone: string}>} contactsData
 */
export const importContactsService = async (tenant_id, contactsData) => {
  const transaction = await db.sequelize.transaction();
  const summary = {
    total: contactsData.length,
    success: 0,
    skipped: 0,
    errors: [],
  };

  try {
    for (const contact of contactsData) {
      try {
        let { name, phone, email } = contact;
        if (!phone) {
          summary.errors.push({
            row: contact,
            error: "Phone number is missing",
          });
          summary.skipped++;
          continue;
        }

        // Clean phone
        phone = phone.toString().replace(/\D/g, "");
        let country_code = null;

        // Split country code if prefixed (assuming last 10 digits are the phone)
        if (phone.length > 10) {
          country_code = `+${phone.slice(0, -10)}`;
          phone = phone.slice(-10);
        } else if (phone.length === 10) {
          country_code = "+91"; // Default to India if only 10 digits
        } else {
          summary.errors.push({
            row: contact,
            error: "Invalid phone number length",
          });
          summary.skipped++;
          continue;
        }

        // Check for existing contact
        const existing = await getContactByPhoneAndTenantIdService(
          tenant_id,
          phone,
          country_code,
        );
        if (existing) {
          summary.skipped++;
          continue;
        }

        // Generate ID and create
        const contact_id = await generateReadableIdFromLast(
          tableNames.CONTACTS,
          "contact_id",
          "CNT",
          5,
          transaction,
        );

        const Query = `
          INSERT INTO ${tableNames.CONTACTS} 
          (contact_id, tenant_id, country_code, phone, name, email, is_blocked, last_message_at) 
          VALUES (?,?,?,?,?,?,?,NOW())`;

        await db.sequelize.query(Query, {
          replacements: [
            contact_id,
            tenant_id,
            country_code,
            phone,
            name || null,
            email || null,
            false,
          ],
          transaction,
        });

        summary.success++;
      } catch (rowErr) {
        summary.errors.push({ row: contact, error: rowErr.message });
        summary.skipped++;
      }
    }

    await transaction.commit();
    return summary;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const toggleSilenceAiService = async (
  contact_id,
  tenant_id,
  is_ai_silenced,
) => {
  const Query = `UPDATE ${tableNames.CONTACTS} SET is_ai_silenced = ? WHERE contact_id = ? AND tenant_id = ?`;
  const [result] = await db.sequelize.query(Query, {
    replacements: [is_ai_silenced, contact_id, tenant_id],
  });
  return result;
};
