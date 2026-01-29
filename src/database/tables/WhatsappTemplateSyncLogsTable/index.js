import { tableNames } from "../../tableName.js";

export const WhatsappTemplateSyncLogTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS, {
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
      type: Sequelize.STRING,
      allowNull: true, // APPROVED / REJECTED / PENDING
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
  });
};
