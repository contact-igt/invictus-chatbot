import { tableNames } from "../../tableName.js";

export const KnowledgeSourcesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.KNOWLEDGESOURCE,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
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
        defaultValue: "inactive",
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
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.KNOWLEDGESOURCE,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_ks_status",
          fields: ["tenant_id", "status", "is_deleted"],
        },
        {
          name: "idx_ks_type",
          fields: ["tenant_id", "type", "is_deleted"],
        },
        {
          name: "idx_ks_deleted",
          fields: ["is_deleted"],
        },
      ],
    }
  );
};
