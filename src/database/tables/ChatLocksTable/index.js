import { tableNames } from "../../tableName.js";

export const ChatLocksTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.CHATLOCKS,
    {
      phone: {
        type: Sequelize.STRING(20),
        allowNull: false,
        primaryKey: true,
      },

      locked_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    },
    {
      tableName: tableNames.CHATLOCKS,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
};
