import { tableNames } from "../../tableName.js";

export const ConversationsTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames?.CONVERSATION, {
    phone: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },

    state: {
      type: Sequelize.ENUM(
        "NEW",
        "WAITING_NAME",
        "WAITING_EMAIL",
        "WAITING_CLINIC",
        "CHAT_MODE"
      ),
      defaultValue: "NEW",
    },

    pending_field: {
      type: Sequelize.ENUM("name", "email", "clinic_name"),
      allowNull: true,
    },
    pending_value: {
      type: Sequelize.TEXT,
      allowNull: true,
    },

    ai_enabled: {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
    },

    assigned_to: {
      type: Sequelize.INTEGER,
      allowNull: true, // null = unassigned
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
