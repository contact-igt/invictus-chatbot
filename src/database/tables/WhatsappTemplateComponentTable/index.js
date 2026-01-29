import { tableNames } from "../../tableName.js";

export const WhatsappTemplateComponentTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.WHATSAPP_TEMPLATE_COMPONENTS, {
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
      type: Sequelize.ENUM("header", "body", "footer"),
      allowNull: false,
      defaultValue: "body",
    },

    text_content: {
      type: Sequelize.TEXT,
      allowNull: false, // message body text
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
