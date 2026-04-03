import { tableNames } from "../../tableName.js";

export const MessageUsageTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MESSAGE_USAGE,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      message_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },

      conversation_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      category: {
        type: Sequelize.ENUM("marketing", "utility", "authentication", "service"),
        allowNull: false,
      },

      billable: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },

      status: {
        type: Sequelize.ENUM("sent", "delivered", "read", "failed"),
        allowNull: false,
      },

      timestamp: {
        type: Sequelize.DATE,
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
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.MESSAGE_USAGE,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "message_id",
          unique: true,
          fields: ["message_id"],
        },
        {
          name: "idx_message_usage_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_message_usage_category",
          fields: ["category"],
        },
        {
          name: "idx_message_usage_timestamp",
          fields: ["timestamp"],
        },
      ],
    }
  );
};
