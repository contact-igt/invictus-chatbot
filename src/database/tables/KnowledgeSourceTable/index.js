import { tableNames } from "../../tableName.js";

export const KnowledgeSourcesTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.KNOWLEDGESOURCE, {
    id: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    title: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    type: {
      type: Sequelize.ENUM("file", "text", "url"),
      allowNull: false,
    },

    file_name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    source_url: {
      type: Sequelize.TEXT,
      allowNull: true,
    },

    raw_text: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    status: {
      type: Sequelize.ENUM("active", "inactive"),
      defaultValue: "active",
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
