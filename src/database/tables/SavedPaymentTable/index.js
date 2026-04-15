import { tableNames } from "../../tableName.js";

export const SavedPaymentTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.SAVE_PAYMENT_METHOD,
    {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      tenant_id: {
        type: Sequelize.STRING, // TT001
        allowNull: false,
      },
      razorpay_customer_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      razorpay_token_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      method_type: {
        type: Sequelize.ENUM("card", "upi", "emandate", "netbanking"),
        allowNull: false,
      },
      method_display: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      last_used_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      failure_count: {
        type: Sequelize.INTEGER,
        defaultValue: 0,
      },
    },
    {
      tableName: tableNames.SAVE_PAYMENT_METHOD,
      timestamps: false,
    },
  );
};
