import { tableNames } from "../../tableName.js";

export const PlansTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.PLANS,
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

      plan_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      plan_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      price: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        defaultValue: null,
      },

      billing_cycle: {
        type: Sequelize.ENUM("monthly", "quarterly", "yearly", "custom"),
        allowNull: true,
        defaultValue: null,
      },

      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      is_active: {
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
      tableName: tableNames.PLANS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_plan_id",
          unique: true,
          fields: ["plan_id"],
        },
        {
          name: "unique_plan_key",
          unique: true,
          fields: ["plan_key"],
        },
        {
          name: "idx_plans_active",
          fields: ["is_active"],
        },
        {
          name: "idx_plans_sort_order",
          fields: ["sort_order"],
        },
      ],
    },
  );
};
