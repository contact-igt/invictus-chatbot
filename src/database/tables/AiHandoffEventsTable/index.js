import { tableNames } from "../../tableName.js";

/**
 * Durable outbox for the single "Our team will contact you instantly." notice
 * that is sent when a contact is paused for repeated user messages.
 *
 * Exactly one row per pause event — enforced by the unique
 * (tenant_id, contact_id, ai_reply_epoch) key.
 */
export const AiHandoffEventsTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.AI_HANDOFF_EVENTS,
    {
      id: {
        type: Sequelize.BIGINT,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      tenant_id: { type: Sequelize.STRING, allowNull: false },
      contact_id: { type: Sequelize.STRING, allowNull: false },
      ai_reply_epoch: { type: Sequelize.INTEGER, allowNull: false },
      trigger_message_id: { type: Sequelize.STRING, allowNull: true },
      reason: {
        type: Sequelize.STRING(48),
        allowNull: false,
        defaultValue: "repeated_user_message",
      },
      notice_text: { type: Sequelize.TEXT, allowNull: false },
      status: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: "pending",
      },
      provider_message_id: { type: Sequelize.STRING, allowNull: true },
      attempt_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      last_attempt_at: { type: Sequelize.DATE, allowNull: true },
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
      tableName: tableNames.AI_HANDOFF_EVENTS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "uniq_handoff_pause_epoch",
          unique: true,
          fields: ["tenant_id", "contact_id", "ai_reply_epoch"],
        },
        { name: "idx_handoff_status", fields: ["status", "last_attempt_at"] },
      ],
    },
  );
};
