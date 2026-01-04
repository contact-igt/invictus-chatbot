import { type } from "os";
import { tableNames } from "../../tableName.js";

export const AppSettingTable = (sequelize, Sequelize) => {
  return sequelize.define(tableNames.APPSETTINGS, {
    label: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    setting_key: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },
    setting_value: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: "false",
    },
    description: {
      type: Sequelize.TEXT,
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
