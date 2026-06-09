import { tableNames } from "../../tableName.js";

export const SidebarSectionIndustriesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      sidebar_section_industry_id: {
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

      industry_id: {
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
      tableName: tableNames.SIDEBAR_SECTION_INDUSTRIES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_sidebar_section_industry_id",
          unique: true,
          fields: ["sidebar_section_industry_id"],
        },
        {
          name: "unique_sidebar_section_industry_map",
          unique: true,
          fields: ["sidebar_section_id", "industry_id"],
        },
        {
          name: "idx_sidebar_section_industries_section",
          fields: ["sidebar_section_id"],
        },
        {
          name: "idx_sidebar_section_industries_industry",
          fields: ["industry_id"],
        },
        {
          name: "idx_sidebar_section_industries_active",
          fields: ["is_active"],
        },
      ],
    },
  );
};
