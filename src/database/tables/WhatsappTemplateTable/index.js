import { tableNames } from "../../tableName.js";

export const WhatsappTemplateTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.WHATSAPP_TEMPLATE, {
    id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },

    template_id: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },

    tenant_id: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    template_name: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },

    category: {
      type: Sequelize.ENUM("utility", "marketing", "authentication"),
      allowNull: false,
    },

    language: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "en",
    },

    template_type: {
      type: Sequelize.ENUM("text"),
      allowNull: false,
      defaultValue: "text",
    },

    status: {
      type: Sequelize.ENUM("draft", "pending", "approved", "rejected"),
      allowNull: false,
      defaultValue: "draft",
    },

    rejection_reason: {
      type: Sequelize.TEXT,
      allowNull: true,
    },

    meta_template_id: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    meta_template_name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    created_by: {
      type: Sequelize.STRING,
      allowNull: false, // tenant_user_id
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
  });
};
