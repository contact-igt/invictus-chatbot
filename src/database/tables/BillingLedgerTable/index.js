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
        allowNull: true,
        unique: true,
        comment:
          "Unique constraint prevents duplicate billing for the same message (NULL for AI entries)",
      },

      ai_token_usage_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        unique: true,
        comment:
          "FK to ai_token_usage — set for AI billing entries (NULL for message entries)",
      },

      entry_type: {
        type: Sequelize.ENUM("message", "ai"),
        allowNull: false,
        defaultValue: "message",
        comment: "Discriminator: message billing vs AI token billing",
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
        allowNull: true,
        comment: "NULL for AI entries",
      },

      rate: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: "Meta rate per message — NULL for AI entries",
      },

      meta_cost: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: "Meta cost — NULL for AI entries",
      },

      platform_fee: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        defaultValue: 0,
        comment: "Platform fee — NULL for AI entries",
      },

      total_cost: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: true,
        comment: "Total cost in USD — NULL for AI entries",
      },

      markup_percent: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
        defaultValue: 0,
      },

      usd_to_inr_rate: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 94.0,
        comment: "USD to INR conversion rate used at billing time",
      },

      total_cost_inr: {
        type: Sequelize.DECIMAL(10, 4),
        allowNull: false,
        defaultValue: 0,
        comment:
          "Total cost in INR (total_cost × usd_to_inr_rate) — actual wallet deduction",
      },

      conversion_rate_used: {
        type: Sequelize.DECIMAL(12, 6),
        allowNull: true,
        comment: "Exact USD→INR rate used at billing time for audit",
      },

      pricing_version: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "PricingTable version at time of billing",
      },

      billing_cycle_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "FK to billing_cycles — set for postpaid entries",
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
        {
          name: "idx_billing_ledger_message_usage",
          unique: true,
          fields: ["message_usage_id"],
        },
        {
          name: "idx_billing_ledger_category",
          fields: ["category"],
        },
        {
          name: "idx_billing_ledger_ai_token_usage",
          unique: true,
          fields: ["ai_token_usage_id"],
        },
        {
          name: "idx_billing_ledger_entry_type",
          fields: ["entry_type"],
        },
      ],
    },
  );
};
