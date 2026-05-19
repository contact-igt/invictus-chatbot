import { tableNames } from "../../tableName.js";

export const NavigationItemsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.NAVIGATION_ITEMS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      navigation_item_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      module_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      label: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      route_path: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      icon_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      parent_item_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      menu_group: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      is_visible: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      tableName: tableNames.NAVIGATION_ITEMS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_navigation_item_id",
          unique: true,
          fields: ["navigation_item_id"],
        },
        {
          name: "idx_navigation_items_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_navigation_items_module",
          fields: ["module_id"],
        },
        {
          name: "idx_navigation_items_parent",
          fields: ["parent_item_id"],
        },
        {
          name: "idx_navigation_items_group",
          fields: ["menu_group"],
        },
        {
          name: "idx_navigation_items_visible",
          fields: ["is_visible"],
        },
        {
          name: "idx_navigation_items_active",
          fields: ["is_active"],
        },
        {
          name: "idx_navigation_items_module_sort",
          fields: ["module_id", "sort_order"],
        },
      ],
    },
  );
};

