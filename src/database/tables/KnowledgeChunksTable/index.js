import { tableNames } from "../../tableName.js";

export const KnowledgeChunksTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.KNOWLEDGECHUNKS,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      source_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: tableNames.KNOWLEDGESOURCE,
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
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.KNOWLEDGECHUNKS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          fields: ["tenant_id"],
        },
        {
          fields: ["source_id"],
        },
      ],
    }
  );
};
