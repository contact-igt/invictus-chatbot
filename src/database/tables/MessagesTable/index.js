import { tableNames } from "../../tableName.js";

export const MessagesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MESSAGES,
    {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      contact_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      phone_number_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      wamid: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "WhatsApp Message ID from Meta",
      },

      wa_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      country_code: {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: "+91",
      },

      phone: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      name: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      sender: {
        type: Sequelize.ENUM("user", "bot", "admin"),
        allowNull: false,
      },

      sender_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      message_type: {
        type: Sequelize.ENUM(
          "text",
          "image",
          "video",
          "document",
          "audio",
          "sticker",
          "location",
          "contact",
          "template",
        ),
        allowNull: false,
        defaultValue: "text",
      },

      message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      media_url: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "URL for media messages (image/video/document/audio)",
      },

      media_mime_type: {
        type: Sequelize.STRING,
        allowNull: true,
      },

      media_filename: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Original filename for document/media messages",
      },

      template_name: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Stores the name of the template if message_type is template",
      },

      status: {
        type: Sequelize.ENUM("sent", "delivered", "read", "failed"),
        allowNull: true,
        defaultValue: null,
        comment: "Delivery status for outgoing messages",
      },

      seen: {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
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
      tableName: tableNames.MESSAGES,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_msg_tenant_contact",
          fields: ["tenant_id", "contact_id"],
        },
        {
          name: "idx_msg_tenant_phone",
          fields: ["tenant_id", "country_code", "phone"],
        },
        {
          name: "unique_msg_wamid",
          unique: true,
          fields: ["wamid"],
        },
        {
          name: "idx_msg_created_at",
          fields: ["created_at"],
        },
        {
          name: "idx_msg_deleted",
          fields: ["is_deleted"],
        },
      ],
    },
  );
};
