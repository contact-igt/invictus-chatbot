import { tableNames } from "../../tableName.js";

export const TaxSettingsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.TAX_SETTINGS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      gst_rate: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        comment: "GST percentage (e.g. 18.00 for 18%)",
      },

      effective_from: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: "Date/time from which this rate is effective",
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Only one row may have is_active = true at any time",
      },

      created_by: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Management admin ID who created this entry",
      },

      notes: {
        type: Sequelize.STRING(500),
        allowNull: true,
        comment: "Optional reason / reference (e.g. Finance notification ref)",
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
      tableName: tableNames.TAX_SETTINGS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          // Enforced at application layer in a transaction; kept here for
          // documentation and as a DB-level safety net via partial uniqueness.
          // Because MySQL <8.0 does not support partial indexes, we enforce
          // single-active-row in the service layer instead.
          name: "idx_tax_settings_effective_from",
          fields: ["effective_from"],
        },
        {
          name: "idx_tax_settings_is_active",
          fields: ["is_active"],
        },
      ],
    },
  );
};
