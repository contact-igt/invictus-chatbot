import { tableNames } from "../../tableName.js";

export const WhatsappTemplateVariableTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.WHATSAPP_TEMPLATE_VARIABLES, {
    id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },

    template_id: {
      type: Sequelize.STRING,
      allowNull: false, // WT001
    },

    variable_key: {
      type: Sequelize.STRING,
      allowNull: false, // {{1}}, {{2}}
    },

    sample_value: {
      type: Sequelize.STRING,
      allowNull: false, // "John", "Tomorrow 10 AM"
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
