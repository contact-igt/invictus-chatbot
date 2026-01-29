import { tableNames } from "../../tableName.js";

export const TenantInvitationsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.TENANT_INVITATIONS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      invitation_id: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_user_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      email: {
        type: Sequelize.STRING,
        allowNull: false,
        validate: { isEmail: true },
      },

      token_hash: {
        type: Sequelize.TEXT,
        allowNull: false,
        unique: true,
      },

      status: {
        type: Sequelize.ENUM("pending", "accepted", "expired", "revoked"),
        allowNull: false,
        defaultValue: "pending",
      },

      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },

      invited_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },

      invited_by: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      createdAt: {
        type: Sequelize.DATE,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },

      updatedAt: {
        type: Sequelize.DATE,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    }
  );
};




