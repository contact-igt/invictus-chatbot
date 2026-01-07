import { tableNames } from "../../tableName.js";

export const ProcessedMessagesTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.PROCESSEDMESSAGE, {
    message_id: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    phone: {
      type: Sequelize.STRING,
      allowNull: true,
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
