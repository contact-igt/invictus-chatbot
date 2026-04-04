import { tableNames } from "../../tableName.js";

export const PaymentHistoryTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.PAYMENT_HISTORY,
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

      razorpay_order_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Razorpay Order ID",
      },

      razorpay_payment_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Razorpay Payment ID - unique to prevent duplicate credits",
      },

      amount: {
        type: Sequelize.DECIMAL(15, 2),
        allowNull: false,
        comment: "Amount in INR",
      },

      currency: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: "INR",
      },

      status: {
        type: Sequelize.ENUM("pending", "success", "failed", "refunded"),
        allowNull: false,
        defaultValue: "pending",
      },

      payment_method: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "UPI, Card, NetBanking, etc.",
      },

      description: {
        type: Sequelize.STRING(255),
        allowNull: true,
        defaultValue: "Wallet Recharge",
      },

      balance_before: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "Wallet balance before this payment",
      },

      balance_after: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: true,
        comment: "Wallet balance after this payment",
      },

      invoice_number: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "Auto-generated invoice number",
      },

      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: "Additional payment metadata from Razorpay",
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
      tableName: tableNames.PAYMENT_HISTORY,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_payment_history_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_payment_history_status",
          fields: ["status"],
        },
        {
          name: "idx_payment_history_razorpay_payment",
          fields: ["razorpay_payment_id"],
          unique: true,
        },
        {
          name: "idx_payment_history_created",
          fields: ["created_at"],
        },
      ],
    },
  );
};
