import { tableNames } from "../../tableName.js";

export const TenantUsersTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.TENANT_USERS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_user_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      email: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: { isEmail: true },
      },

      country_code: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      mobile: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      profile: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      password_hash: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      role: {
        type: Sequelize.ENUM(
          "tenant_admin",
          "doctor",
          "staff",
          "agent"
        ),
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
        defaultValue: sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        ),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.TENANT_USERS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_tenant_user_email",
          unique: true,
          fields: ["tenant_id", "email"], // ✅ per-tenant email uniqueness
        },
        {
          name: "unique_tenant_user_mobile",
          unique: true,
          fields: ["tenant_id", "mobile"], // ✅ per-tenant mobile uniqueness
        },
        {
          name: "idx_tenant_user_deleted",
          fields: ["tenant_id", "is_deleted"],
        },
        {
          name: "unique_tenant_user_id",
          unique: true,
          fields: ["tenant_user_id"],
        },
      ],
    }
  );
};


