import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateReadableIdFromLast } from "../../utils/generateReadableIdFromLast.js";

/**
 * Creates a new contact group
 */
export const createContactGroupService = async (tenant_id, data) => {
    const transaction = await db.sequelize.transaction();
    try {
        const { group_name, description } = data;

        // Check if group name already exists for this tenant
        const existingGroup = await db.ContactGroups.findOne({
            where: { tenant_id, group_name, is_deleted: false }
        });

        if (existingGroup) {
            throw new Error(`Group with name "${group_name}" already exists`);
        }

        // Generate Group ID
        const group_id = await generateReadableIdFromLast(
            tableNames.CONTACT_GROUPS,
            "group_id",
            "GRP",
            5
        );

        // Create Group
        const group = await db.ContactGroups.create(
            {
                group_id,
                tenant_id,
                group_name,
                description,
            },
            { transaction }
        );

        await transaction.commit();
        return group;
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
};

/**
 * Get all groups for a tenant
 */
export const getContactGroupListService = async (tenant_id, query) => {
    const { search, page = 1, limit = 10 } = query;
    const offset = (page - 1) * limit;

    let where = { tenant_id, is_deleted: false };
    if (search) {
        where.group_name = { [db.Sequelize.Op.like]: `%${search}%` };
    }

    const { count, rows } = await db.ContactGroups.findAndCountAll({
        where,
        order: [["created_at", "DESC"]],
        limit: parseInt(limit),
        offset: parseInt(offset),
        include: [
            {
                model: db.ContactGroupMembers,
                as: "members",
                attributes: ["id", "contact_id"],
            },
        ],
    });

    return {
        totalItems: count,
        groups: rows,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
    };
};

/**
 * Get a single group by ID with members
 */
export const getContactGroupByIdService = async (group_id, tenant_id) => {
    const group = await db.ContactGroups.findOne({
        where: { group_id, tenant_id, is_deleted: false },
        include: [
            {
                model: db.ContactGroupMembers,
                as: "members",
                include: [
                    {
                        model: db.Contacts,
                        as: "contact",
                        attributes: ["contact_id", "name", "phone", "email"],
                    },
                ],
            },
        ],
    });
    return group;
};

/**
 * Add contacts to a group
 */
export const addContactsToGroupService = async (group_id, tenant_id, contact_ids) => {
    const transaction = await db.sequelize.transaction();
    try {
        // Verify group exists and belongs to tenant
        const group = await db.ContactGroups.findOne({
            where: { group_id, tenant_id, is_deleted: false },
        });

        if (!group) {
            throw new Error("Group not found");
        }

        // Verify all contacts exist and belong to tenant
        const existingContacts = await db.Contacts.findAll({
            where: {
                contact_id: contact_ids,
                tenant_id,
                is_deleted: false,
            },
            attributes: ["contact_id"],
        });

        const validContactIds = existingContacts.map((c) => c.contact_id);

        if (validContactIds.length === 0) {
            throw new Error("No valid contacts found to add");
        }

        // Prepare member data
        const memberData = validContactIds.map((contact_id) => ({
            group_id,
            contact_id,
            tenant_id,
        }));

        // Bulk create (will skip duplicates if unique constraint exists)
        await db.ContactGroupMembers.bulkCreate(memberData, {
            transaction,
            ignoreDuplicates: true,
        });

        await transaction.commit();
        return { message: "Contacts added successfully" };
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
};

/**
 * Remove a contact from a group
 */
export const removeContactFromGroupService = async (group_id, contact_id, tenant_id) => {
    const result = await db.ContactGroupMembers.destroy({
        where: { group_id, contact_id, tenant_id },
    });

    if (result === 0) {
        throw new Error("Member not found in group");
    }

    return { message: "Contact removed from group" };
};

/**
 * Delete a group (soft delete)
 */
export const deleteContactGroupService = async (group_id, tenant_id) => {
    const transaction = await db.sequelize.transaction();
    try {
        const group = await db.ContactGroups.findOne({
            where: { group_id, tenant_id, is_deleted: false },
        });

        if (!group) {
            throw new Error("Group not found");
        }

        await group.update(
            {
                is_deleted: true,
                deleted_at: new Date(),
            },
            { transaction }
        );

        await transaction.commit();
        return { message: "Group deleted successfully" };
    } catch (err) {
        await transaction.rollback();
        throw err;
    }
};
