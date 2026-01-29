import { tableNames } from "../../tableName.js";

export const TenantsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.TENANTS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true, // TT001
      },

      company_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      owner_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      owner_email: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
      },

      owner_country_code: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      owner_mobile: {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true,
      },

      type: {
        type: Sequelize.ENUM("hospital", "clinic", "organization"),
        allowNull: false,
      },

      status: {
        type: Sequelize.ENUM("invited", "active", "rejected", "suspended"),
        defaultValue: "invited",
        allowNull: false,
      },

      subscription_start_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      subscription_end_date: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      profile: {
        type: Sequelize.STRING,
        allowNull: true,
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
    }
  );
};
