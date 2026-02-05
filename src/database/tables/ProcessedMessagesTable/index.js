import { tableNames } from "../../tableName.js";

export const ProcessedMessagesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.PROCESSEDMESSAGE,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      phone_number_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      message_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      phone: {
        type: Sequelize.STRING,
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
      tableName: tableNames.PROCESSEDMESSAGE,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_proc_msg_id",
          unique: true,
          fields: ["message_id"],
        },
        {
          name: "idx_proc_msg_tenant_phone",
          fields: ["tenant_id", "phone_number_id"],
        },
        {
          name: "idx_proc_msg_created_at",
          fields: ["created_at"],
        },
      ],
    }
  );
};
