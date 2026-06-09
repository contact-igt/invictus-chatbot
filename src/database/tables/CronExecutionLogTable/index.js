import { tableNames } from "../../tableName.js";

export const CronExecutionLogTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.CRON_EXECUTION_LOG,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      job_name: {
        type: Sequelize.STRING,
        allowNull: false,
        comment:
          "e.g. billing_cycle_cron, health_check_cron, reconciliation_cron",
      },

      status: {
        type: Sequelize.ENUM("running", "completed", "failed"),
        allowNull: false,
        defaultValue: "running",
      },

      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },

      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      cycles_closed: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      invoices_generated: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      overdue_marked: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },
    },
    {
      tableName: tableNames.CRON_EXECUTION_LOG,
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        {
          name: "idx_cron_log_job_status",
          fields: ["job_name", "status"],
        },
        {
          name: "idx_cron_log_started",
          fields: ["started_at"],
        },
      ],
    },
  );
};
