import { tableNames } from "../../tableName.js";

export const WhatsappTemplateComponentTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.WHATSAPP_TEMPLATE_COMPONENTS,
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

      component_type: {
        type: Sequelize.ENUM("header", "body", "footer", "buttons", "carousel"),
        allowNull: false,
      },

      header_format: {
        type: Sequelize.ENUM("text", "image", "video", "document", "location"),
        allowNull: true, // only for header
      },

      text_content: {
        type: Sequelize.TEXT,
        allowNull: true, // ❗ must be nullable
      },

      media_url: {
        type: Sequelize.TEXT,
        allowNull: true, // ❗ header media only
      },

      media_asset_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      media_handle: {
        type: Sequelize.TEXT,
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
      tableName: tableNames.WHATSAPP_TEMPLATE_COMPONENTS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_component_template",
          fields: ["template_id"],
        },
        {
          name: "unique_template_component_type",
          unique: true,
          fields: ["template_id", "component_type"],
        },
      ],
    },
  );
};
