import { tableNames } from "../../tableName.js";

export const ManagementTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MANAGEMENT,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      management_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      title: {
        type: Sequelize.ENUM("Dr", "Mr", "Ms", "Mrs"),
        allowNull: true,
      },

      username: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      email: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: { isEmail: true },
      },

      country_code: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      mobile: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      password: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      profile: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      role: {
        type: Sequelize.ENUM("super_admin", "platform_admin"),
        allowNull: false,
      },

      status: {
        type: Sequelize.ENUM("active", "inactive"),
        defaultValue: "active",
        allowNull: false,
      },

      is_deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },

      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
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
        defaultValue: sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
        ),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.MANAGEMENT,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_mgmt_id",
          unique: true,
          fields: ["management_id"],
        },
        {
          name: "unique_mgmt_email",
          unique: true,
          fields: ["email"],
        },
        {
          name: "unique_mgmt_mobile",
          unique: true,
          fields: ["mobile"],
        },
        {
          name: "idx_mgmt_role",
          fields: ["role"],
        },
        {
          name: "idx_mgmt_deleted",
          fields: ["is_deleted"],
        },
      ],
    }
  );
};
