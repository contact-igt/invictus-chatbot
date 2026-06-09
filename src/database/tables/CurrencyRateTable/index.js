import { tableNames } from "../../tableName.js";

export const CurrencyRateTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.CURRENCY_RATES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      currency_from: {
        type: Sequelize.STRING(3),
        allowNull: false,
        comment: "Source currency code (e.g. USD)",
      },

      currency_to: {
        type: Sequelize.STRING(3),
        allowNull: false,
        comment: "Target currency code (e.g. INR)",
      },

      conversion_rate: {
        type: Sequelize.DECIMAL(12, 6),
        allowNull: false,
        comment: "Exchange rate",
      },

      source: {
        type: Sequelize.ENUM("manual", "api"),
        allowNull: false,
        defaultValue: "manual",
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
      tableName: tableNames.CURRENCY_RATES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_currency_pair",
          unique: true,
          fields: ["currency_from", "currency_to"],
        },
        {
          name: "idx_currency_rates_updated",
          fields: ["updated_at"],
        },
      ],
    },
  );
};
