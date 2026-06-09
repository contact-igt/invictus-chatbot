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

      is_deleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
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
        {
          // Composite index for the hot retrieval path: active chunks per source
          name: "idx_chunk_active_lookup",
          fields: ["tenant_id", "source_id", "is_deleted"],
        },
        {
          name: "idx_chunk_deleted",
          fields: ["is_deleted"],
        },
      ],
    },
  );
};
