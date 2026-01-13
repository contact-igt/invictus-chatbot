import { tableNames } from "../../tableName.js";

export const ManagementTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.MANAGEMENT, {
    tenant_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
    },

    title: {
      type: Sequelize.ENUM("Dr", "Mr", "Ms", "Mrs"),
      allowNull: true,
    },

    username: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    email: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },

    country_code: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    mobile: {
      type: Sequelize.STRING,
      unique: true,
    },

    password: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    profile: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    role: {
      type: Sequelize.ENUM("super_admin", "admin", "staff"),
      allowNull: false,
    },

    status: {
      type: Sequelize.ENUM("active", "inactive"),
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
