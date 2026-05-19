import { tableNames } from "../../tableName.js";

export const TenantSaaSModuleOverridesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.TENANT_SAAS_MODULE_OVERRIDES,
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

      module_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      is_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
      },

      metadata: {
        type: Sequelize.JSON,
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
    },
    {
      tableName: tableNames.TENANT_SAAS_MODULE_OVERRIDES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_tenant_saas_module_override",
          unique: true,
          fields: ["tenant_id", "module_id"],
        },
        {
          name: "idx_tenant_saas_module_overrides_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_tenant_saas_module_overrides_module",
          fields: ["module_id"],
        },
        {
          name: "idx_tenant_saas_module_overrides_enabled",
          fields: ["is_enabled"],
        },
      ],
    },
  );
};

