import { tableNames } from "../../tableName.js";

export const SidebarSectionPlansTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.SIDEBAR_SECTION_PLANS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      sidebar_section_plan_id: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },

      sidebar_section_id: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },

      plan_id: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
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
      tableName: tableNames.SIDEBAR_SECTION_PLANS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_sidebar_section_plan_id",
          unique: true,
          fields: ["sidebar_section_plan_id"],
        },
        {
          name: "unique_sidebar_section_plan_map",
          unique: true,
          fields: ["sidebar_section_id", "plan_id"],
        },
        {
          name: "idx_sidebar_section_plans_section",
          fields: ["sidebar_section_id"],
        },
        {
          name: "idx_sidebar_section_plans_plan",
          fields: ["plan_id"],
        },
        {
          name: "idx_sidebar_section_plans_active",
          fields: ["is_active"],
        },
      ],
    },
  );
};
