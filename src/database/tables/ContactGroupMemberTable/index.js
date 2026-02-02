import { tableNames } from "../../tableName.js";

export const ContactGroupMemberTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.CONTACT_GROUP_MEMBERS,
        {
            id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
            },

            group_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            contact_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            tenant_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            createdAt: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
                field: "created_at",
            },

            updatedAt: {
                type: Sequelize.DATE,
                allowNull: false,
                field: "updated_at",
            },
        },
        {
            tableName: tableNames.CONTACT_GROUP_MEMBERS,
            timestamps: true,
            underscored: true,
            indexes: [
                {
                    name: "idx_group_contact",
                    unique: true,
                    fields: ["group_id", "contact_id"],
                },
                {
                    name: "idx_tenant_group_member",
                    fields: ["tenant_id", "group_id"],
                },
            ],
        },
    );
};


