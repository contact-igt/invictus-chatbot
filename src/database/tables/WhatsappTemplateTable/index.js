import { tableNames } from "../../tableName.js";

export const WhatsappTemplateTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.WHATSAPP_TEMPLATE,
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

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      template_name: {
        type: Sequelize.STRING,
        allowNull: false,
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
        type: Sequelize.ENUM(
          "draft", // created, not submitted
          "pending", // submitted, under review
          "approved", // approved by Meta
          "rejected", // rejected by Meta
          "paused", // quality issue
          "disabled", // permenantly disabled by meta,
        ),
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
        defaultValue: sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        ),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.WHATSAPP_TEMPLATE,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_template_id",
          unique: true,
          fields: ["template_id"],
        },
        {
          name: "unique_tenant_template_name",
          unique: true,
          fields: ["tenant_id", "template_name"],
        },
      ],
    },
  );
};
