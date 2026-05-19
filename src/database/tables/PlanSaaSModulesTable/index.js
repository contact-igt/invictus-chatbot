import { tableNames } from "../../tableName.js";

export const PlanSaaSModulesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.PLAN_SAAS_MODULES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      plan_id: {
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
        defaultValue: true,
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
      tableName: tableNames.PLAN_SAAS_MODULES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_plan_saas_module",
          unique: true,
          fields: ["plan_id", "module_id"],
        },
        {
          name: "idx_plan_saas_modules_plan",
          fields: ["plan_id"],
        },
        {
          name: "idx_plan_saas_modules_module",
          fields: ["module_id"],
        },
        {
          name: "idx_plan_saas_modules_enabled",
          fields: ["is_enabled"],
        },
      ],
    },
  );
};

