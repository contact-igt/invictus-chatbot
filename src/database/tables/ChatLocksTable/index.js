import { tableNames } from "../../tableName.js";

export const ChatLocksTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.CHATLOCKS,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      phone_number_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      phone: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      locked_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.CHATLOCKS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_chatlock_tenant_phone",
          unique: true,
          fields: ["tenant_id", "phone_number_id", "phone"],
        },
        {
          name: "idx_chatlock_locked_at",
          fields: ["locked_at"],
        },
      ],
    }
  );
};
