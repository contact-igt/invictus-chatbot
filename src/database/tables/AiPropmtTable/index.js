import { tableNames } from "../../tableName.js";

export const AiPromptTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.AIPROMPT, {
    name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    prompt: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    is_active: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "false",
    },

    createdAt: {
      type: "TIMESTAMP",
      allowNull: true,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "created_at",
    },

    updatedAt: {
      type: "TIMESTAMP",
      allowNull: true,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "updated_at",
    },
  });
};


