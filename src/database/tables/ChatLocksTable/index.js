import { tableNames } from "../../tableName.js";

export const ChatLocksTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.CHATLOCKS,
    {
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

      phone: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
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
    },
  );
};
