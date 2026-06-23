import { tableNames } from "../../tableName.js";

export const AppointmentReminderRulesTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.APPOINTMENT_REMINDER_RULES,
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
      rule_name: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: "Reminder",
        comment: "Human-readable label, e.g. '1 day before at 10 AM'",
      },
      rule_type: {
        type: Sequelize.ENUM("fixed_day_time", "relative_before"),
        allowNull: true,
        comment: "null = legacy offset_minutes fallback",
      },
      // ── fixed_day_time fields ───────────────────────────────────────────────
      days_before: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "fixed_day_time: calendar days before appointment (0 = same day)",
      },
      send_time: {
        type: Sequelize.STRING(5),
        allowNull: true,
        comment: "fixed_day_time: time to send in HH:mm (24h, IST), e.g. '10:00'",
      },
      // ── relative_before fields ──────────────────────────────────────────────
      hours_before: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "relative_before: hours to subtract from appointment datetime",
      },
      minutes_before: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "relative_before: additional minutes to subtract from appointment datetime",
      },
      // ── legacy fallback ─────────────────────────────────────────────────────
      offset_minutes: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "Legacy: negative = before appointment. Kept for backward compatibility.",
      },
      // ── shared ──────────────────────────────────────────────────────────────
      template_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Local template_id for the reminder WhatsApp message",
      },
      header_media_url: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      header_file_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      sort_order: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "Display/execution order within a tenant's rule set",
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    },
    {
      tableName: tableNames.APPOINTMENT_REMINDER_RULES,
      timestamps: false,
      indexes: [
        {
          name: "idx_reminder_rules_tenant",
          fields: ["tenant_id"],
        },
        {
          name: "idx_reminder_rules_active",
          fields: ["tenant_id", "is_active"],
        },
      ],
    },
  );
};
