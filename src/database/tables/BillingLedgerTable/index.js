import { tableNames } from "../../tableName.js";

export const BillingLedgerTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.BILLING_LEDGER,
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

      message_usage_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },

      template_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      campaign_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      category: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      country: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
      },

      meta_cost: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
      },

      platform_fee: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
      },

      total_cost: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
      },
      
      markup_percent: {
        type: Sequelize.DECIMAL(5, 2),
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
      tableName: tableNames.BILLING_LEDGER,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_billing_ledger_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_billing_ledger_created_at",
          fields: ["created_at"],
        },
      ],
    }
  );
};
