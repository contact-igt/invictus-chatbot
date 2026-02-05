import { tableNames } from "../../tableName.js";

export const ContactGroupTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.CONTACT_GROUPS,
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

            tenant_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            group_name: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            description: {
                type: Sequelize.TEXT,
                allowNull: true,
            },

            is_deleted: {
                type: Sequelize.BOOLEAN,
                defaultValue: false,
                allowNull: false,
            },

            deleted_at: {
                type: Sequelize.DATE,
                allowNull: true,
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
            tableName: tableNames.CONTACT_GROUPS,
            timestamps: true,
            underscored: true,
            indexes: [
                {
                    name: "unique_group_id",
                    unique: true,
                    fields: ["group_id"],
                },
                {
                    name: "unique_tenant_group_name",
                    unique: true,
                    fields: ["tenant_id", "group_name", "is_deleted"],
                },
                {
                    name: "idx_tenant_group",
                    fields: ["tenant_id", "is_deleted"],
                },
            ],
        },
    );
};
