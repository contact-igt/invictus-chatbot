import { tableNames } from "../../tableName.js";

export const ContactsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.CONTACTS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      contact_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      country_code: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "+91",
      },

      phone: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      wa_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "WhatsApp ID for contact identification",
      },

      name: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      email: {
        type: Sequelize.STRING,
        allowNull: true,
        validate: { isEmail: true },
      },

      age: {
        type: Sequelize.INTEGER,
        allowNull: true,
        validate: { min: 0, max: 150 },
      },

      profile_pic: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      is_ai_silenced: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      is_blocked: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      // ── Repeated User Message → AI Handoff (additive; feature-flag gated) ──
      repeat_message_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      repeat_message_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      repeat_last_received_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      ai_pause_reason: {
        type: Sequelize.STRING(48),
        allowNull: true,
        comment: "manual | repeated_user_message | repeated_ai_reply (NULL = legacy manual silence)",
      },
      ai_paused_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      ai_reply_epoch: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },

      last_message_at: {
        type: Sequelize.DATE,
        allowNull: true,
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
      tableName: tableNames.CONTACTS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_contact_id",
          unique: true,
          fields: ["contact_id"],
        },
        {
          name: "unique_contact_phone_tenant",
          unique: true,
          fields: ["tenant_id", "country_code", "phone", "is_deleted"],
        },
        {
          name: "idx_contact_wa_id",
          fields: ["tenant_id", "wa_id", "is_deleted"],
        },
        {
          name: "idx_contact_last_message",
          fields: ["last_message_at"],
        },
        {
          name: "idx_contact_blocked",
          fields: ["is_blocked", "is_deleted"],
        },
        {
          name: "idx_contact_deleted",
          fields: ["is_deleted"],
        },
      ],
    },
  );
};
