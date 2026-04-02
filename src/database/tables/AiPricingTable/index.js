import { tableNames } from "../../tableName.js";

export const AiPricingTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.AI_PRICING,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      model: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "AI model name (e.g., gpt-4o, gpt-4o-mini)",
      },

      description: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Human-readable description of the model",
      },

      recommended_for: {
        type: Sequelize.ENUM("input", "output", "both"),
        allowNull: false,
        defaultValue: "both",
        comment:
          "Whether the model is recommended for input processing, output generation, or both",
      },

      category: {
        type: Sequelize.ENUM("premium", "mid-tier", "budget", "reasoning"),
        allowNull: false,
        defaultValue: "mid-tier",
        comment: "Pricing tier category for UI grouping",
      },

      input_rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
        comment: "Cost per 1M input tokens in USD",
      },

      output_rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
        comment: "Cost per 1M output tokens in USD",
      },

      markup_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
        comment: "Platform markup percentage on top of base cost",
      },

      usd_to_inr_rate: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 94.0,
        comment:
          "USD to INR conversion rate — update billing.config.js to change default",
      },

      pricing_version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: "Incremented on every rate/markup update",
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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
      tableName: tableNames.AI_PRICING,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_ai_pricing_model",
          unique: true,
          fields: ["model"],
        },
      ],
    },
  );
};
