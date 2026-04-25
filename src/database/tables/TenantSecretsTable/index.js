import { tableNames } from "../../tableName.js";

export const TenantSecretsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.TENANT_SECRETS,
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
      type: {
        type: Sequelize.ENUM("openai", "whatsapp"),
        allowNull: false,
      },
      encrypted_value: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      iv: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      auth_tag: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      key_version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
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
      tableName: tableNames.TENANT_SECRETS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_tenant_secret_type",
          unique: true,
          fields: ["tenant_id", "type"],
        },
      ],
    },
  );
};
