import { tableNames } from "../../tableName.js";

export const TenantsTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.TENANTS, {
    name: {
      type: Sequelize.STRING,
      allowNull: true,
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

    type: {
      type: Sequelize.ENUM("hospital", "clinic"),
      allownull: false,
    },

    status: {
      type: Sequelize.ENUM("active", "inactive"),
      allownull: false,
      defaultValue: "active",
    },

    profile: {
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
