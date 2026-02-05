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
        type: Sequelize.STRING(255),
        allowNull: false,
      },

      status: {
        type: Sequelize.ENUM("pending", "accepted", "expired", "revoked", "completed"),
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
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        ),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.TENANT_INVITATIONS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_invite_id",
          unique: true,
          fields: ["invitation_id"],
        },
        {
          name: "unique_invite_token",
          unique: true,
          fields: ["token_hash"],
        },
        {
          name: "idx_invite_tenant_email",
          fields: ["tenant_id", "email", "status"],
        },
        {
          name: "idx_invite_expiry",
          fields: ["expires_at"],
        },
      ],
    },
  );
};


