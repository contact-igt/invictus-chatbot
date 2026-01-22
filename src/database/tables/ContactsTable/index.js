import { tableNames } from "../../tableName.js";

export const ContactsTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames?.CONTACTS, {
    tenant_id: {
      type: Sequelize.INTEGER,
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

    profile_pic: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    last_message_at: {
      type: Sequelize.DATE,
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
