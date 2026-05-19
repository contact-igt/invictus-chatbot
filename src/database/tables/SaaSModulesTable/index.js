import { tableNames } from "../../tableName.js";

export const SaaSModulesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.SAAS_MODULES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      module_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      module_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      module_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      category: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      parent_module_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      route_path: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      icon_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      module_type: {
        type: Sequelize.ENUM(
          "core",
          "feature",
          "addon",
          "experimental",
          "enterprise",
        ),
        allowNull: false,
        defaultValue: "feature",
      },

      visibility_type: {
        type: Sequelize.ENUM("sidebar", "hidden", "internal", "api_only"),
        allowNull: false,
        defaultValue: "sidebar",
      },

      is_system_core: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      tableName: tableNames.SAAS_MODULES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_saas_module_id",
          unique: true,
          fields: ["module_id"],
        },
        {
          name: "unique_saas_module_key",
          unique: true,
          fields: ["module_key"],
        },
        {
          name: "idx_saas_modules_category",
          fields: ["category"],
        },
        {
          name: "idx_saas_modules_parent",
          fields: ["parent_module_id"],
        },
        {
          name: "idx_saas_modules_type",
          fields: ["module_type"],
        },
        {
          name: "idx_saas_modules_visibility",
          fields: ["visibility_type"],
        },
        {
          name: "idx_saas_modules_core",
          fields: ["is_system_core"],
        },
        {
          name: "idx_saas_modules_active",
          fields: ["is_active"],
        },
      ],
    },
  );
};

