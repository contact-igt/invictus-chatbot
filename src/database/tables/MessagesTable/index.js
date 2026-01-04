import { tableNames } from "../../tableName.js";

export const MessagesTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames?.MESSAGES, {
    // id: {
    //   type: Sequelize.INTEGER,
    //   autoIncrement: true,
    //   primaryKey: true,
    // },

    // conversation_id: {
    //   type: Sequelize.INTEGER,
    //   allowNull: true,
    // },

    wa_id: {
      type: Sequelize.STRING,
      allowNull: true,
    },

    phone: {
      type: Sequelize.STRING,
      allowNull: false,
    },

    sender: {
      type: Sequelize.ENUM("user", "bot", "admin"),
      allowNull: false,
    },

    message: {
      type: Sequelize.TEXT,
      allowNull: false,
    },

    seen: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "false",
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
