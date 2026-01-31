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
        type: Sequelize.TEXT, // encrypted token
        allowNull: false,
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

      last_error: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        ),
        field: "updated_at",
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
