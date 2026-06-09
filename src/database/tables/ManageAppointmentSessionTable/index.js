import { tableNames } from "../../tableName.js";

export const ManageAppointmentSessionTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.MANAGE_APPOINTMENT_SESSIONS,
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
        type: Sequelize.STRING,
        allowNull: false,
      },
      user_phone: {
        type: Sequelize.STRING(30),
        allowNull: false,
      },
      contact_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      state: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      appointment_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      appointment_ids: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      selected_appointment_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      pending_edit_field: {
        type: Sequelize.STRING(30),
        allowNull: true,
      },
      pending_edit_value: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      selected_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      selected_slot_id: {
        type: Sequelize.STRING(100),
        allowNull: true,
      },
      selected_time: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      selected_doctor_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      current_page: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      status: {
        type: Sequelize.ENUM("ACTIVE", "EXPIRED", "COMPLETED", "CANCELLED"),
        allowNull: false,
        defaultValue: "ACTIVE",
      },
      last_active_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
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
      tableName: tableNames.MANAGE_APPOINTMENT_SESSIONS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_manage_appointment_session_id",
          unique: true,
          fields: ["session_id"],
        },
        {
          name: "idx_manage_appt_session_user",
          fields: ["tenant_id", "user_phone", "status"],
        },
        {
          name: "idx_manage_appt_session_expiry",
          fields: ["status", "expires_at"],
        },
      ],
    },
  );
};
