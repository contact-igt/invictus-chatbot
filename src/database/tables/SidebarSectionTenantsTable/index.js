import { tableNames } from "../../tableName.js";

export const SidebarSectionTenantsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.SIDEBAR_SECTION_TENANTS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      sidebar_section_tenant_id: {
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

      tenant_id: {
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

      title_override: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      is_visible_override: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
      },

      sort_order_override: {
        type: Sequelize.INTEGER,
        allowNull: true,
        validate: {
          min: 0,
        },
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
      tableName: tableNames.SIDEBAR_SECTION_TENANTS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_sidebar_section_tenant_id",
          unique: true,
          fields: ["sidebar_section_tenant_id"],
        },
        {
          name: "unique_sidebar_section_tenant_map",
          unique: true,
          fields: ["sidebar_section_id", "tenant_id"],
        },
        {
          name: "idx_sidebar_section_tenants_section",
          fields: ["sidebar_section_id"],
        },
        {
          name: "idx_sidebar_section_tenants_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_sidebar_section_tenants_active",
          fields: ["is_active"],
        },
      ],
    },
  );
};
