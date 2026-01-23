import { tableNames } from "../../tableName.js";

export const LiveChatTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.LIVECHAT, {
    tenant_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },

    contact_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },

    last_message_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },

    assigned_admin_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
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
