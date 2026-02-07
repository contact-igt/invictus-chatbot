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
        validate: { isEmail: true },
      },

      owner_country_code: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      owner_mobile: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      type: {
        type: Sequelize.ENUM("hospital", "clinic", "organization"),
        allowNull: false,
      },

      status: {
        type: Sequelize.ENUM(
          "invited",
          "active",
          "inactive",
          "rejected",
          "suspended",
          "trial",
          "expired",
          "pending_setup",
          "grace_period",
          "maintenance"
        ),
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
        defaultValue: sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        ),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.TENANTS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_tenant_id",
          unique: true,
          fields: ["tenant_id"],
        },
        {
          name: "idx_tenant_status",
          fields: ["status"],
        },
        {
          name: "idx_tenant_deleted",
          fields: ["is_deleted"],
        },
        {
          name: "unique_owner_email",
          unique: true,
          fields: ["owner_email"],
        },
        {
          name: "unique_owner_mobile",
          unique: true,
          fields: ["owner_mobile"],
        },
      ],
    },
  );
};
