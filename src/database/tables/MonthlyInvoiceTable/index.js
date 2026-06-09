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
        references: {
          model: "billing_cycles",
          key: "id",
        },
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
        comment: "Total invoice amount in INR (base + GST)",
      },

      // ── Cost breakdown ──────────────────────────────────────────────────────
      total_message_cost_inr: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
        comment: "Message billing sub-total for this cycle (INR)",
      },

      total_ai_cost_inr: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
        comment: "AI token billing sub-total for this cycle (INR)",
      },

      // ── GST breakdown ───────────────────────────────────────────────────────
      base_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "Taxable value (usage cost before GST)",
      },

      gst_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "Total GST (18% of base_amount)",
      },

      total_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "base_amount + gst_amount (mirrors amount column, for explicit reference)",
      },

      cgst_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        defaultValue: 0,
        comment: "CGST (9%) — only set for intra-state transactions",
      },

      sgst_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        defaultValue: 0,
        comment: "SGST (9%) — only set for intra-state transactions",
      },

      igst_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        defaultValue: 0,
        comment: "IGST (18%) — only set for inter-state transactions",
      },

      // ── GST jurisdiction ────────────────────────────────────────────────────
      tenant_state: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "Tenant state code at invoice generation time (e.g. TN)",
      },

      company_state: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "Company state code at invoice generation time",
      },

      hsn_sac_code: {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: "998314",
        comment: "HSN/SAC code for the service",
      },

      tenant_gstin: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: "Tenant GSTIN if provided (for B2B invoice)",
      },

      gst_rate: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        comment: "GST % rate used at invoice generation time (snapshot — never changed retroactively)",
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
        {
          // Used by the overdue-invoice cron: WHERE status = 'unpaid' AND due_date < NOW()
          name: "idx_monthly_invoices_status_due",
          fields: ["status", "due_date"],
        },
      ],
    },
  );
};
