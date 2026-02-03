import { tableNames } from "../../tableName.js";

export const WhatsappCampaignRecipientTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.WHATSAPP_CAMPAIGN_RECIPIENT,
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

            contact_id: {
                type: Sequelize.STRING,
                allowNull: true,
            },

            mobile_number: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            status: {
                type: Sequelize.ENUM("pending", "sent", "delivered", "read", "replied", "failed"),
                defaultValue: "pending",
                allowNull: false,
            },

            meta_message_id: {
                type: Sequelize.STRING,
                allowNull: true,
            },

            error_message: {
                type: Sequelize.TEXT,
                allowNull: true,
            },

            dynamic_variables: {
                type: Sequelize.JSON,
                allowNull: true,
                comment: "Array of variable values for template placeholders, e.g., ['John', '10:00 AM']",
            },

            is_deleted: {
                type: Sequelize.BOOLEAN,
                defaultValue: false,
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
                defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
                field: "updated_at",
            },
        },
        {
            tableName: tableNames.WHATSAPP_CAMPAIGN_RECIPIENT,
            timestamps: true,
            underscored: true,
            indexes: [
                {
                    name: "idx_recipient_campaign",
                    fields: ["campaign_id"],
                },
                {
                    name: "idx_recipient_status",
                    fields: ["status"],
                },
                {
                    name: "idx_recipient_meta_id",
                    fields: ["meta_message_id"],
                },
                {
                    name: "idx_recipient_mobile",
                    fields: ["mobile_number"],
                },
            ],
        },
    );
};
