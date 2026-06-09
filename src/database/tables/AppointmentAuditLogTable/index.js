import { tableNames } from "../../tableName.js";

export const AppointmentAuditLogTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.APPOINTMENT_AUDIT_LOGS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      appointment_id: {
        type: Sequelize.STRING(50),
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      action_type: {
        type: Sequelize.ENUM(
          "VIEWED",
          "UPDATED_NAME",
          "UPDATED_PHONE",
          "UPDATED_EMAIL",
          "UPDATED_REASON",
          "RESCHEDULED",
          "CANCELLED",
        ),
        allowNull: false,
      },
      old_value: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      new_value: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      changed_by: {
        type: Sequelize.STRING(30),
        allowNull: false,
      },
      changed_from: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: "WHATSAPP",
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
        field: "created_at",
      },
    },
    {
      tableName: tableNames.APPOINTMENT_AUDIT_LOGS,
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        {
          name: "idx_appointment_audit_lookup",
          fields: ["tenant_id", "appointment_id", "created_at"],
        },
        {
          name: "idx_appointment_audit_action",
          fields: ["tenant_id", "action_type", "created_at"],
        },
      ],
    },
  );
};
