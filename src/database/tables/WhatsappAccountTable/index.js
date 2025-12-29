import { tableNames } from "../../tableName.js";

export const whatsappAccountTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.WHATSAPP_ACCOUNT, {
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: true,
    },

    phone_number_id: {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    },

    waba_id: {
      type: Sequelize.STRING,
      allownull: false,
    },

    access_token: {
      type: Sequelize.STRING,
      allownull: false,
      unique: true,
    },

    client_status: {
      type: Sequelize.STRING,
      allownull: false,
      unique: true,
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
