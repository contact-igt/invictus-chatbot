import { tableNames } from "../../tableName.js";

export const ManagementTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames?.MANAGEMENT, {
    id: {
      type: Sequelize.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },

    tenant_id: {
      type: Sequelize.BIGINT,
      allowNull: true, // SUPER_ADMIN
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
      allowNull: true,
      unique: true,
    },

    password: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    

    role: {
      type: Sequelize.ENUM("super_admin", "admin", "staff"),
      allowNull: false,
    },

    status: {
      type: Sequelize.ENUM("active", "inactive"),
      defaultValue: "active",
    },
  });
};



