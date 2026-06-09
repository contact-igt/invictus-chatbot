import { tableNames } from "../../tableName.js";

export const MonthlyUsageSummaryTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MONTHLY_USAGE_SUMMARY,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      summary_month: {
        type: Sequelize.STRING(7),
        allowNull: false,
        comment: "Format: YYYY-MM",
      },

      total_messages: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      billable_messages: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      message_cost_inr: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
      },

      ai_calls: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      ai_tokens_used: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      ai_cost_inr: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
      },

      total_cost_inr: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
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
      tableName: tableNames.MONTHLY_USAGE_SUMMARY,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_monthly_summary",
          unique: true,
          fields: ["tenant_id", "summary_month"],
        },
      ],
    },
  );
};
