import { tableNames } from "../../tableName.js";

export const ChatStateTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.CHATSTATE, {
    tenant_id: {
      type: Sequelize.INTEGER,
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

    name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    ai_enable: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "true",
    },

    state: {
      type: Sequelize.ENUM("ai_active", "need_admin", "admin_active"),
      allowNull: false,
      defaultValue: "ai_active",
    },

    last_user_message_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },

    heat_state: {
      type: Sequelize.ENUM("hot", "warm", "cold", "super_cold"),
      allowNull: false,
      defaultValue: "super_cold",
    },

    heat_score: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    claimed_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
    },

    summary_text: {
      type: Sequelize.TEXT,
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
