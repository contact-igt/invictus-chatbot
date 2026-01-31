import { tableNames } from "../../tableName.js";

export const ContactsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.CONTACTS,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
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

      profile_pic: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      is_blocked: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.CONTACTS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_contact_phone_tenant",
          unique: true,
          fields: ["tenant_id", "phone", "is_deleted"],
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
    }
  );
};
