import { tableNames } from "../../tableName.js";

export const AppointmentStateLogTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.APPOINTMENT_STATE_LOGS,
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
      user_phone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      session_id: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      from_state: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      to_state: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      reply_id: {
        type: Sequelize.STRING(256),
        allowNull: true,
      },
      whatsapp_message_id: {
        type: Sequelize.STRING(128),
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
      tableName: tableNames.APPOINTMENT_STATE_LOGS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "idx_appointment_state_session",
          fields: ["tenant_id", "session_id"],
        },
        {
          name: "idx_appointment_state_msg",
          fields: ["tenant_id", "whatsapp_message_id"],
        },
      ],
    },
  );
};
