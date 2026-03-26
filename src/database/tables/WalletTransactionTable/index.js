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
      ],
    }
  );
};
