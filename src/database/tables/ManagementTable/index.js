import { tableNames } from "../../tableName.js";

export const ManagementTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.MANAGEMENT, {
    name: {
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

    mobile: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
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



// id
// name
// email
// mobile
// password
// role        → super-admin | admin | agent
// status      → active / inactive
// created_at
