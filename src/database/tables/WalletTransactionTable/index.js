import { tableNames } from "../../tableName.js";

export const WalletTransactionTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.WALLET_TRANSACTIONS,
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

      type: {
        type: Sequelize.ENUM("credit", "debit"),
        allowNull: false,
      },

      amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        comment: "Wallet credit/debit amount (base_amount for recharges, cost for deductions)",
      },

      gross_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "Total amount the tenant paid incl. GST (only set for recharge credits)",
      },

      base_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "Taxable value credited to wallet (gross / 1.18) — same as amount for credits",
      },

      gst_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "GST component (gross - base) — only set for recharge credits",
      },

      gst_rate: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: 18.00,
        comment: "GST rate applied (18.00 for India)",
      },

      reference_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Payment ID or Ledger ID",
      },

      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      balance_after: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "Wallet balance after this transaction for audit trail",
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
      tableName: tableNames.WALLET_TRANSACTIONS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_wallet_transactions_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_wallet_transactions_type",
          fields: ["type"],
        },
        {
          name: "idx_wallet_transactions_reference",
          fields: ["reference_id"],
        },
        {
          name: "idx_wallet_transactions_created",
          fields: ["created_at"],
        },
      ],
    },
  );
};
