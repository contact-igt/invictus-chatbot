import { tableNames } from "../../tableName.js";

export const AppointmentSlotTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.APPOINTMENT_SLOTS,
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
      doctor_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      appointment_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      appointment_time: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM("AVAILABLE", "LOCKED", "BOOKED", "EXPIRED"),
        allowNull: false,
        defaultValue: "LOCKED",
      },
      locked_by_session_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      locked_until: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      appointment_id: {
        type: Sequelize.STRING(50),
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
      tableName: tableNames.APPOINTMENT_SLOTS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_appointment_slot",
          unique: true,
          fields: ["tenant_id", "doctor_id", "appointment_date", "appointment_time"],
        },
        {
          name: "idx_appointment_slot_lock",
          fields: ["locked_by_session_id", "status"],
        },
        {
          name: "idx_appointment_slot_expiry",
          fields: ["status", "locked_until"],
        },
      ],
    },
  );
};
