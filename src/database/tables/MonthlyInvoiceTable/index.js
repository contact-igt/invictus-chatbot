import { tableNames } from "../../tableName.js";

export const MonthlyInvoiceTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MONTHLY_INVOICES,
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

      billing_cycle_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      invoice_number: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Format: INV-YYYYMMDD-XXXXX",
      },

      amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
        comment: "Total invoice amount in INR",
      },

      due_date: {
        type: Sequelize.DATE,
        allowNull: false,
        comment: "Payment deadline (cycle_end + 15 days)",
      },

      status: {
        type: Sequelize.ENUM("unpaid", "paid", "overdue", "cancelled"),
        allowNull: false,
        defaultValue: "unpaid",
      },

      paid_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      payment_reference: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Razorpay payment ID or admin reference",
      },

      retry_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "Number of payment retry attempts",
      },

      last_retry_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "Timestamp of last retry attempt",
      },

      conversion_rate_used: {
        type: Sequelize.DECIMAL(12, 6),
        allowNull: true,
        comment: "USD to INR rate used at invoice generation time",
      },

      pricing_version_range: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "{ min, max } pricing versions used during this cycle",
      },

      breakdown: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "{ messages: X, ai: Y, total: Z }",
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
      tableName: tableNames.MONTHLY_INVOICES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_monthly_invoices_tenant_status",
          fields: ["tenant_id", "status"],
        },
        {
          name: "idx_monthly_invoices_tenant_due",
          fields: ["tenant_id", "due_date"],
        },
        {
          name: "unique_invoice_number",
          unique: true,
          fields: ["invoice_number"],
        },
        {
          name: "unique_tenant_billing_cycle",
          unique: true,
          fields: ["tenant_id", "billing_cycle_id"],
        },
      ],
    },
  );
};
