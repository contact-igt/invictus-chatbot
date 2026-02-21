import { tableNames } from "../../tableName.js";

export const SpecializationsTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.SPECIALIZATIONS,
        {
            id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
            },

            specialization_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            tenant_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            name: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            description: {
                type: Sequelize.TEXT,
                allowNull: true,
            },

            is_active: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },

            is_deleted: {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
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
                defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
                field: "updated_at",
            },
        },
        {
            tableName: tableNames.SPECIALIZATIONS,
            timestamps: true,
            underscored: true,
            indexes: [
                {
                    name: "unique_specialization_id",
                    unique: true,
                    fields: ["specialization_id"],
                },
                {
                    name: "unique_specialization_per_tenant",
                    unique: true,
                    fields: ["tenant_id", "name"],
                },
            ],
        }
    );
};
