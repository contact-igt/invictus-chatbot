import { tableNames } from "../../tableName.js";

export const ChatLocksTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.CHATLOCKS, {
    phone: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    locked_at: {
      type: "TIMESTAMP",
      allowNull: true,
      defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
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
