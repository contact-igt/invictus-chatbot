import { tableNames } from "../../tableName.js";

export const WalletTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.WALLETS,
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
        unique: true,
      },

      balance: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 0,
      },

      currency: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "INR",
      },

      auto_recharge_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      auto_recharge_threshold: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 100,
        comment: "Trigger auto-recharge when balance drops below this amount",
      },

      auto_recharge_amount: {
        type: Sequelize.DECIMAL(15, 4),
        allowNull: false,
        defaultValue: 500,
        comment: "Amount to recharge when triggered",
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
      tableName: tableNames.WALLETS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_wallets_tenant",
          fields: ["tenant_id"],
        },
      ],
    },
  );
};
