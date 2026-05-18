import { tableNames } from "../../tableName.js";

export const TenantFeatureAccessTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.TENANT_FEATURE_ACCESS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      feature_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      is_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
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
      tableName: tableNames.TENANT_FEATURE_ACCESS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "uniq_tenant_feature_access",
          unique: true,
          fields: ["tenant_id", "feature_key"],
        },
        {
          name: "idx_tenant_feature_access_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_tenant_feature_access_feature",
          fields: ["feature_key"],
        },
      ],
    },
  );
};
