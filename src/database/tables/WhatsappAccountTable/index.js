import { tableNames } from "../../tableName.js";

export const WhatsappAccountTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.WHATSAPP_ACCOUNT,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      tenant_id: {
        type: Sequelize.STRING, // TT001
        allowNull: false,
      },

      whatsapp_number: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },

      phone_number_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      waba_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      access_token: {
        type: Sequelize.TEXT, // encrypted token (deprecated - now stored in tenant_secrets)
        allowNull: true, // Made nullable since tokens are now stored in tenant_secrets
      },

      app_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      provider: {
        type: Sequelize.ENUM("meta"),
        defaultValue: "meta",
      },

      status: {
        type: Sequelize.ENUM(
          "pending", // saved but not tested
          "verified", // verification successful
          "active", // ready to send messages
          "inactive", // manually disabled
          "token_error", // Meta access token invalid or insufficient permissions
          "token_expired",
          "failed",
        ),
        defaultValue: "pending",
        allowNull: false,
      },

      is_verified: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false,
      },

      verified_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      // WhatsApp Business quality rating from Meta.
      // "UNKNOWN" = Meta has not rated the number yet (too few messages) or the
      // sync has not run — never assume GREEN without evidence.
      quality: {
        type: Sequelize.ENUM("GREEN", "YELLOW", "RED", "UNKNOWN"),
        allowNull: true,
        defaultValue: "UNKNOWN",
        comment: "Meta WABA quality rating (UNKNOWN until synced from Meta)",
      },

      // Deployment region (e.g. Global, India, US)
      region: {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: "Global",
        comment: "Deployment region label",
      },

      // Meta WABA messaging tier constant: TIER_NOT_SET | TIER_2K | TIER_10K
      // | TIER_100K | TIER_UNLIMITED. Matches META_TIER_CONFIG keys.
      tier: {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: "TIER_NOT_SET",
        comment: "Meta WABA messaging tier constant (TIER_NOT_SET until synced)",
      },

      meta_info_synced_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "Last successful quality/tier refresh from Meta",
      },

      last_error: {
        type: Sequelize.TEXT,
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
      is_deleted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    },
    {
      tableName: tableNames.WHATSAPP_ACCOUNT,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_wa_acc_tenant",
          unique: true,
          fields: ["tenant_id"],
        },
        {
          name: "unique_wa_acc_num",
          unique: true,
          fields: ["whatsapp_number"],
        },
        {
          name: "unique_wa_acc_phone_id",
          unique: true,
          fields: ["phone_number_id"],
        },
        {
          name: "idx_wa_acc_status",
          fields: ["status"],
        },
      ],
    },
  );
};
