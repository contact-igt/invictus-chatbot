import { tableNames } from "../../tableName.js";

export const ScheduledMessageTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.SCHEDULED_MESSAGES,
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
      contact_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      appointment_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      template_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Local template_id — used to look up name/language at send time",
      },
      to_phone: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Full E.164-style phone: country_code + contact_number",
      },
      send_type: {
        type: Sequelize.ENUM("follow_up", "noshow"),
        allowNull: false,
      },
      scheduled_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("pending", "sent", "failed"),
        allowNull: false,
        defaultValue: "pending",
      },
      sent_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      error_log: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    },
    {
      tableName: tableNames.SCHEDULED_MESSAGES,
      timestamps: false,
      indexes: [
        {
          name: "idx_sched_msg_pending",
          fields: ["status", "scheduled_at"],
        },
        {
          name: "idx_sched_msg_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_sched_msg_appointment",
          fields: ["appointment_id"],
        },
      ],
    },
  );
};
