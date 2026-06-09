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
      },

      tenant_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },

      contact_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },

      user_phone: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },

      flow_type: {
        type: Sequelize.ENUM("book", "edit", "cancel"),
        allowNull: false,
      },

      current_step: {
        type: Sequelize.STRING(30),
        allowNull: true,
        defaultValue: null,
      },

      last_valid_state: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },

      draft_json: {
        type: Sequelize.JSON,
        allowNull: true,
      },

      edit_target: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },

      previous_step: {
        type: Sequelize.STRING(30),
        allowNull: true,
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
        type: Sequelize.STRING(30),
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
        field: "created_at",
      },

      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        field: "updated_at",
      },
    },
    {
      tableName: tableNames.BOOKING_SESSIONS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_session_id",
          unique: true,
          fields: ["session_id"],
        },
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
