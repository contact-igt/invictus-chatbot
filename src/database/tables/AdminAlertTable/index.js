import { tableNames } from "../../tableName.js";

export const AdminAlertTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.ADMINALERT, {
    phone: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    summary_text: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    last_user_message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    last_bot_message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    reason: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    status: {
      type: Sequelize.ENUM("open", "claimed", "resolved"),
      allowNull: false,
      defaultValue: "open",
    },

    assigned_id: {
      type: Sequelize.STRING,
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

// id
// phone
// name
// summary_text
// last_user_message
// last_bot_message
// status              open | claimed | resolved
// assigned_admin_id   NULL or managements.id
// created_at
// updated_at
