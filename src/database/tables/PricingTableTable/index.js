import { tableNames } from "../../tableName.js";

export const PricingTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.PRICING_TABLE,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      category: {
        type: Sequelize.ENUM(
          "marketing",
          "utility",
          "authentication",
          "service",
        ),
        allowNull: false,
      },

      country: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
      },

      markup_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: 0,
      },

      pricing_version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: "Incremented on every rate/markup update",
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
      tableName: tableNames.PRICING_TABLE,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_pricing_category_country",
          unique: true,
          fields: ["category", "country"],
        },
      ],
    },
  );
};
