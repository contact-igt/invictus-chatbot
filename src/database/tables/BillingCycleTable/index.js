import { tableNames } from "../../tableName.js";

export const BillingCycleTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.BILLING_CYCLES,
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

      cycle_number: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },

      start_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },

      end_date: {
        type: Sequelize.DATE,
        allowNull: false,
      },

      status: {
        type: Sequelize.ENUM("active", "completed", "invoiced"),
        allowNull: false,
        defaultValue: "active",
      },

      total_message_cost_inr: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
        comment: "Running total of message billing in this cycle",
      },

      total_ai_cost_inr: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
        comment: "Running total of AI billing in this cycle",
      },

      total_cost_inr: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
        comment: "Grand total (messages + AI)",
      },

      is_locked: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "True while cron is processing — prevents duplicate close",
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
      tableName: tableNames.BILLING_CYCLES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_billing_cycles_tenant_status",
          fields: ["tenant_id", "status"],
        },
        {
          name: "idx_billing_cycles_tenant_end",
          fields: ["tenant_id", "end_date"],
        },
        {
          name: "unique_tenant_cycle_number",
          unique: true,
          fields: ["tenant_id", "cycle_number"],
        },
      ],
    },
  );
};
