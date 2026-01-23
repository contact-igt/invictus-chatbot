import { tableNames } from "../../tableName.js";

export const MessagesTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.MESSAGES, {
    tenant_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },

    contact_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },

    phone_number_id: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    wa_id: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    phone: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    sender: {
      type: Sequelize.ENUM("user", "bot", "admin"),
      allowNull: false,
    },

    sender_id: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    seen: {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
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
