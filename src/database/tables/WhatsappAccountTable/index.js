import { tableNames } from "../../tableName.js";

export const whatsappAccountTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.WHATSAPP_ACCOUNT, {
    tenant_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
    },

    whatsapp_number: {
      type: Sequelize.STRING,
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
      type: Sequelize.TEXT,
      allowNull: false,
    },

    provider: {
      type: Sequelize.ENUM("meta"),
      defaultValue: "meta",
    },

    status: {
      type: Sequelize.ENUM("active", "inactive"),
      defaultValue: "active",
    },
    createdAt: {
      type: "TIMESTAMP",
      allowNull: true,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "created_at",
    },

    updatedAt: {
      type: "TIMESTAMP",
      allowNull: true,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      field: "updated_at",
    },
  });
};
