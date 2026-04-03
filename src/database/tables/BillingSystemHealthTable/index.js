import { tableNames } from "../../tableName.js";

export const BillingSystemHealthTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.BILLING_SYSTEM_HEALTH,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      event_type: {
        type: Sequelize.ENUM(
          "billing_failure",
          "payment_failure",
          "cron_failure",
          "invoice_error",
          "lock_conflict",
          "currency_fetch_error",
          "reconciliation_mismatch",
          "reconciliation_report",
        ),
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Affected tenant (null for system-wide events)",
      },

      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "Stack trace, context data",
      },

      resolved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },
    },
    {
      tableName: tableNames.BILLING_SYSTEM_HEALTH,
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        {
          name: "idx_bshealth_type_resolved",
          fields: ["event_type", "resolved"],
        },
        {
          name: "idx_bshealth_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_bshealth_created",
          fields: ["created_at"],
        },
      ],
    },
  );
};
