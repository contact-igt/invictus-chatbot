import { tableNames } from "../../tableName.js";

export const UserPreferencesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.USER_PREFERENCES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_user_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      management_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      user_type: {
        type: Sequelize.ENUM("tenant", "management"),
        allowNull: false,
        defaultValue: "tenant",
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      theme: {
        type: Sequelize.ENUM("light", "dark"),
        allowNull: false,
        defaultValue: "light",
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.USER_PREFERENCES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_user_preferences_user",
          unique: true,
          fields: ["tenant_user_id"],
        },
        {
          name: "unique_user_preferences_management",
          unique: true,
          fields: ["management_id"],
        },
        {
          name: "idx_user_preferences_tenant",
          fields: ["tenant_id"],
        },
      ],
    }
  );
};
