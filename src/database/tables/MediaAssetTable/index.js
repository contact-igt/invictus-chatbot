import crypto from "crypto";
import { tableNames } from "../../tableName.js";

const getMediaHandleHash = (mediaHandle) => {
  if (!mediaHandle) {
    return null;
  }

  return crypto.createHash("sha256").update(mediaHandle).digest("hex");
};

export const MediaAssetTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MEDIA_ASSETS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      media_asset_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      file_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },

      file_type: {
        type: Sequelize.ENUM("image", "video", "document"),
        allowNull: false,
      },

      mime_type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },

      file_size: {
        type: Sequelize.BIGINT,
        allowNull: false,
      },

      media_handle: {
        type: Sequelize.TEXT,
        allowNull: false,
      },

      media_handle_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },

      preview_url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      tags: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: [],
      },

      folder: {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: "root",
      },

      is_approved: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      templates_used: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: [],
      },

      campaigns_used: {
        type: Sequelize.JSON,
        allowNull: true,
        defaultValue: [],
      },

      uploaded_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      handle_expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
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
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.MEDIA_ASSETS,
      timestamps: true,
      underscored: true,
      hooks: {
        beforeValidate: (mediaAsset) => {
          mediaAsset.setDataValue(
            "media_handle_hash",
            getMediaHandleHash(mediaAsset.getDataValue("media_handle")),
          );
        },
      },
      indexes: [
        {
          name: "unique_media_asset_id",
          unique: true,
          fields: ["media_asset_id"],
        },
        {
          name: "idx_media_assets_tenant_id",
          fields: ["tenant_id", "is_deleted"],
        },
        {
          name: "idx_media_assets_is_approved",
          fields: ["is_approved", "is_deleted"],
        },
        {
          name: "idx_media_assets_file_type",
          fields: ["file_type", "is_deleted"],
        },
        {
          name: "idx_media_assets_media_handle",
          unique: true,
          fields: ["media_handle_hash"],
        },
        {
          name: "idx_media_assets_deleted",
          fields: ["is_deleted"],
        },
      ],
    },
  );
};
