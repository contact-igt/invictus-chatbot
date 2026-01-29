import { tableNames } from "../../tableName.js";

export const TenantUsersTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.TENANT_USERS, {
    id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
    },

    tenant_user_id: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true, // TU001
    },

    tenant_id: {
      type: Sequelize.STRING,
      allowNull: false, // references tenants.tenant_id
    },

    name: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    email: {
      type: Sequelize.STRING,
      allowNull: false,
      validate: { isEmail: true },
      unique: true,
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

    profile: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    password_hash: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    role: {
      type: Sequelize.ENUM(
        "tenant_admin", // phase 1
        "doctor", // phase 2
        "staff",
        "agent",
      ),
      defaultValue: "tenant_admin",
      allowNull: false,
    },

    status: {
      type: Sequelize.ENUM("active", "inactive"),
      defaultValue: "inactive",
      allowNull: false,
    },

    is_deleted: {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },

    deleted_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },

    createdAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "created_at",
    },

    updatedAt: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "updated_at",
    },
  });
};
