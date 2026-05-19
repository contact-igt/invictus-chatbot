import { tableNames } from "../../tableName.js";

export const IndustriesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.INDUSTRIES,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      industry_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      industry_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      industry_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },

      metadata: {
        type: Sequelize.JSON,
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
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.INDUSTRIES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_industry_id",
          unique: true,
          fields: ["industry_id"],
        },
        {
          name: "unique_industry_key",
          unique: true,
          fields: ["industry_key"],
        },
        {
          name: "idx_industries_active",
          fields: ["is_active"],
        },
      ],
    },
  );
};

