import { tableNames } from "../../tableName.js";

export const BookingSessionTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.BOOKING_SESSIONS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      session_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
        unique: true,
      },

      tenant_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },

      contact_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },

      flow_type: {
        type: Sequelize.ENUM("book", "edit", "cancel"),
        allowNull: false,
      },

      current_step: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: "doctor",
      },

      // Collected data (NULL = not yet collected)
      doctor_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },

      doctor_name: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },

      date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },

      time: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },

      patient_name: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },

      age: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      email: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },

      reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      appointment_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: "For edit/cancel flows",
      },

      edit_fields: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'For edit: {"time":"03:00 PM"}',
      },

      // Lifecycle
      status: {
        type: Sequelize.ENUM("active", "completed", "cancelled", "expired"),
        allowNull: false,
        defaultValue: "active",
      },

      expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: "Auto-expire after 30 min inactivity",
      },

      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal(
          "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        ),
      },
    },
    {
      tableName: tableNames.BOOKING_SESSIONS,
      timestamps: true,
      indexes: [
        {
          name: "idx_session_tenant",
          fields: ["tenant_id", "contact_id", "status"],
        },
        {
          name: "idx_session_expiry",
          fields: ["expires_at", "status"],
        },
      ],
    },
  );
};
