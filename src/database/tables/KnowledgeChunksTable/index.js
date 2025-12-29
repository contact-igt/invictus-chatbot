import { tableNames } from "../../tableName.js";

export const KnowledgeChunksTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames?.KNOWLEDGECHUNKS, {
    source_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: tableNames?.KNOWLEDGESOURCE,
        key: "id",
      },
    },

    chunk_text: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    embedding: {
      type: Sequelize.JSON,
      allowNull: false,
    },

    createdAt: {
      type: "TIMESTAMP",
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "created_at",
    },
  });
};
