import { tableNames } from "../../tableName.js";

export const WhatsappCampaignTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.WHATSAPP_CAMPAIGN,
        {
            id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
            },

            campaign_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            tenant_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            campaign_name: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            campaign_type: {
                type: Sequelize.ENUM("broadcast", "api", "scheduled"),
                allowNull: false,
            },

            template_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            status: {
                type: Sequelize.ENUM("draft", "scheduled", "active", "completed", "failed"),
                defaultValue: "draft",
                allowNull: false,
            },

            total_audience: {
                type: Sequelize.INTEGER,
                defaultValue: 0,
            },

            delivered_count: {
                type: Sequelize.INTEGER,
                defaultValue: 0,
            },

            read_count: {
                type: Sequelize.INTEGER,
                defaultValue: 0,
            },

            replied_count: {
                type: Sequelize.INTEGER,
                defaultValue: 0,
            },

            scheduled_at: {
                type: Sequelize.DATE,
                allowNull: true,
            },

            is_deleted: {
                type: Sequelize.BOOLEAN,
                defaultValue: false,
            },

            deleted_at: {
                type: Sequelize.DATE,
                allowNull: true,
            },

            created_by: {
                type: Sequelize.STRING,
                allowNull: true,
            },

            updated_by: {
                type: Sequelize.STRING,
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
                defaultValue: sequelize.literal(
                    "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
                ),
                field: "updated_at",
            },
        },
        {
            tableName: tableNames.WHATSAPP_CAMPAIGN,
            timestamps: true,
            underscored: true,
            indexes: [
                {
                    name: "unique_campaign_id",
                    unique: true,
                    fields: ["campaign_id"],
                },
                {
                    name: "idx_campaign_tenant",
                    fields: ["tenant_id"],
                },
                {
                    name: "idx_campaign_status",
                    fields: ["status"],
                },
                {
                    name: "idx_campaign_deleted",
                    fields: ["is_deleted"],
                },
            ],
        },
    );
};
