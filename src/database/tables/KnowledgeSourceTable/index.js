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
      type: Sequelize.ENUM("text", "pdf", "doc", "docx", "url"),
      allowNull: false,
    },

    file_name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    // file_url: {
    //   type: Sequelize.TEXT,
    //   allowNull: true, // cloudinary
    // },

    source_url: {
      type: Sequelize.TEXT,
      allowNull: true, // website
    },

    raw_text: {
      type: Sequelize.TEXT,
      allowNull: false, // extracted content
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
