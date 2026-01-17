import { tableNames } from "../../tableName.js";

export const ProcessedMessagesTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.PROCESSEDMESSAGE, {
    tenant_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      unique: true,
    },

    phone_number_id: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },

    message_id: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },

    phone: {
      type: Sequelize.STRING,
      allowNull: false,
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
