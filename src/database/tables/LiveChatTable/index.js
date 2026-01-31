import { tableNames } from "../../tableName.js";

export const LiveChatTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.LIVECHAT,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      contact_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      status: {
        type: Sequelize.ENUM("active", "closed", "pending"),
        allowNull: false,
        defaultValue: "active",
      },

      last_message_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      assigned_admin_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "tenant_user_id of assigned agent",
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
      tableName: tableNames.LIVECHAT,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_livechat_tenant_contact",
          unique: true,
          fields: ["tenant_id", "contact_id"],
        },
        {
          name: "idx_livechat_tenant_status",
          fields: ["tenant_id", "status"],
        },
        {
          name: "idx_livechat_assigned_admin",
          fields: ["assigned_admin_id"],
        },
        {
          name: "idx_livechat_last_msg",
          fields: ["last_message_at"],
        },
      ],
    }
  );
};
