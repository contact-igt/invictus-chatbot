import { tableNames } from "../../tableName.js";

export const LeadsTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames?.LEADS, {
    tenant_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },

    contact_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      unique: true,
    },

    score: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },

    heat_state: {
      type: Sequelize.ENUM("hot", "warm", "cold", "supercold"),
      allowNull: false,
      defaultValue: "cold",
    },

    ai_summary: {
      type: Sequelize.TEXT,
      allowNull: true,
    },

    summary_status: {
      type: Sequelize.ENUM("new", "old"),
      allowNull: false,
      defaultValue: "new",
    },

    last_user_message_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },

    last_admin_reply_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },

    status: {
      type: Sequelize.ENUM("active", "archived", "blocked"),
      allowNull: false,
      defaultValue: "active",
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
