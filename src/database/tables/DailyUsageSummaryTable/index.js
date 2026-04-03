import { tableNames } from "../../tableName.js";

export const DailyUsageSummaryTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.DAILY_USAGE_SUMMARY,
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

      summary_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        comment: "The day being summarized",
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
      tableName: tableNames.DAILY_USAGE_SUMMARY,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_daily_summary",
          unique: true,
          fields: ["tenant_id", "summary_date"],
        },
      ],
    },
  );
};
