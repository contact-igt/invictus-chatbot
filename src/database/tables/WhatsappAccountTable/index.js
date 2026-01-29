import { tableNames } from "../../tableName.js";

export const whatsappAccountTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.WHATSAPP_ACCOUNT, {
    tenant_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      unique: true,
    },

    whatsapp_number: {
      type: Sequelize.STRING(20),
      allowNull: false,
      unique: true,
    },

    phone_number_id: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },

    waba_id: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    access_token: {
      type: Sequelize.TEXT, // store encrypted
      allowNull: false,
    },

    provider: {
      type: Sequelize.ENUM("meta"),
      defaultValue: "meta",
    },

    status: {
      type: Sequelize.ENUM(
        "pending", // saved but not tested
        "verified", // test success
        "active", // ready to send messages
        "inactive", // manually disabled
        "token_expired",
        "failed",
      ),
      defaultValue: "pending",
    },

    is_verified: {
      type: Sequelize.STRING,
      defaultValue: "false",
    },

    verified_at: {
      type: Sequelize.DATE,
      allowNull: true,
    },

    last_error: {
      type: Sequelize.TEXT,
      allowNull: true,
    },

    createdAt: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      field: "created_at",
    },

    updatedAt: {
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      field: "updated_at",
    },
  });
};
