import { tableNames } from "../../tableName.js";

export const AppointmentTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.APPOINTMENTS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      appointment_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      doctor_id: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: "Optional doctor selection",
      },

      contact_id: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Link to contacts table",
      },

      patient_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      contact_number: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      age: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      email: {
        type: Sequelize.STRING,
        allowNull: true,
        validate: { isEmail: true },
      },

      appointment_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },

      appointment_time: {
        type: Sequelize.STRING,
        allowNull: false,
        comment: "Format: hh:mm A (e.g. 10:30 AM)",
      },
      status: {
        type: Sequelize.ENUM(
          "Pending",
          "Confirmed",
          "Completed",
          "Cancelled",
          "Noshow",
        ),
        allowNull: false,
        defaultValue: "Pending",
      },

      token_number: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: "Can be generated daily or per doctor",
      },

      is_reminder_sent: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      is_feedback_requested: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: "Notes from manual entry or AI conversation",
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
      tableName: tableNames.APPOINTMENTS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_appointment_id",
          unique: true,
          fields: ["appointment_id"],
        },
        {
          name: "idx_appointment_tenant",
          fields: ["tenant_id", "status"],
        },
        {
          name: "idx_appointment_contact",
          fields: ["contact_id"],
        },
        {
          name: "idx_appointment_doctor",
          fields: ["doctor_id"],
        },
        {
          name: "idx_appointment_date",
          fields: ["appointment_date"],
        },
        {
          name: "idx_appointment_deleted",
          fields: ["is_deleted"],
        },
      ],
    },
  );
};
