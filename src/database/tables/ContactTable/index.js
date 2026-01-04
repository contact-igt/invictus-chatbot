import { tableNames } from "../../tableName.js";

export const ContactTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames?.CONTACTS, {
    phone: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },

    name: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    email: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    clinic_name: {
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
