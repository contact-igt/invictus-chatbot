import { tableNames } from "../../tableName.js";

export const BillingHoldTable = (sequelize, Sequelize) =>
  sequelize.define(
    tableNames.BILLING_HOLDS,
    {
      id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
      hold_id: { type: Sequelize.STRING(96), allowNull: false, unique: true },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      campaign_id: { type: Sequelize.STRING, allowNull: true },
      billing_mode: {
        type: Sequelize.ENUM("prepaid", "postpaid"),
        allowNull: false,
      },
      amount: { type: Sequelize.DECIMAL(15, 6), allowNull: false },
      remaining_amount: { type: Sequelize.DECIMAL(15, 6), allowNull: false },
      status: {
        type: Sequelize.ENUM("active", "consumed", "released"),
        allowNull: false,
        defaultValue: "active",
      },
      expires_at: { type: Sequelize.DATE, allowNull: false },
      released_at: { type: Sequelize.DATE, allowNull: true },
      release_reason: { type: Sequelize.STRING(255), allowNull: true },
      metadata: { type: Sequelize.JSON, allowNull: true },
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
      tableName: tableNames.BILLING_HOLDS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_billing_holds_tenant_status",
          fields: ["tenant_id", "status"],
        },
        { name: "idx_billing_holds_campaign", fields: ["campaign_id"] },
        { name: "idx_billing_holds_expiry", fields: ["status", "expires_at"] },
      ],
    },
  );
