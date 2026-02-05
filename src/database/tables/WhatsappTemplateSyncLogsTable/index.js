import { tableNames } from "../../tableName.js";

export const WhatsappTemplateSyncLogTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      template_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      action: {
        type: Sequelize.ENUM("submit", "sync"),
        allowNull: false,
      },

      request_payload: {
        type: Sequelize.JSON,
        allowNull: true,
      },

      response_payload: {
        type: Sequelize.JSON,
        allowNull: true,
      },

      meta_status: {
        type: Sequelize.ENUM("approved", "rejected", "pending" , "failed"),
        allowNull: true,
      },

      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },
    },
    {
      tableName: tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS,
      timestamps: false, // 🔒 log table
      underscored: true,
      indexes: [
        {
          fields: ["template_id"], // 🔥 important
        },
      ],
    },
  );
};
