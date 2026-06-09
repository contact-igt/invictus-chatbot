import { tableNames } from "../../tableName.js";

const SECTION_KEY_REGEX = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const SidebarSectionsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.SIDEBAR_SECTIONS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      sidebar_section_id: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },

      section_key: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
          isSnakeCase(value) {
            if (!SECTION_KEY_REGEX.test(value || "")) {
              throw new Error("section_key must be lowercase snake_case");
            }
          },
        },
      },

      title: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: {
          notEmpty: true,
          isNonBlank(value) {
            if (!value || value.trim() === "") {
              throw new Error("title is required");
            }
          },
        },
      },

      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      assignment_mode: {
        type: Sequelize.ENUM("global", "scoped"),
        allowNull: false,
        defaultValue: "global",
        validate: {
          isIn: [["global", "scoped"]],
        },
      },

      is_visible: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      is_system_core: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      tableName: tableNames.SIDEBAR_SECTIONS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_sidebar_section_id",
          unique: true,
          fields: ["sidebar_section_id"],
        },
        {
          name: "unique_sidebar_section_key",
          unique: true,
          fields: ["section_key"],
        },
        {
          name: "idx_sidebar_sections_active",
          fields: ["is_active"],
        },
        {
          name: "idx_sidebar_sections_visible",
          fields: ["is_visible"],
        },
        {
          name: "idx_sidebar_sections_sort_order",
          fields: ["sort_order"],
        },
        {
          name: "idx_sidebar_sections_assignment_mode",
          fields: ["assignment_mode"],
        },
      ],
    },
  );
};
