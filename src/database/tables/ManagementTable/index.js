import { tableNames } from "../../tableName.js";

export const ManagementTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.MANAGEMENT, {
    title: {
      type: Sequelize.ENUM("Dr", "Mr", "Ms", "Mrs"),
      allowNull: false,
    },

    username: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    email: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },

    country_code: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    mobile: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },

    profile_picture: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    password: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    role: {
      type: Sequelize.ENUM("super-admin", "admin", "agent"),
      allowNull: false,
      defaultValue: "agent",
    },

    status: {
      type: Sequelize.ENUM("active", "inactive", "suspended"),
      defaultValue: "active",
    },

    last_login_at: {
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



