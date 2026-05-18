import { tableNames } from "../../tableName.js";

export const AppointmentOutcomeTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.APPOINTMENT_OUTCOMES,
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
      notes: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      follow_up_required: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      follow_up_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      follow_up_type: {
        type: Sequelize.ENUM("Call", "Visit", "WhatsApp"),
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW,
      },
    },
    {
      tableName: tableNames.APPOINTMENT_OUTCOMES,
      timestamps: false,
      indexes: [
        {
          name: "idx_outcome_tenant_appointment",
          unique: true,
          fields: ["tenant_id", "appointment_id"],
        },
        {
          name: "idx_outcome_follow_up_date",
          fields: ["follow_up_date"],
        },
      ],
    },
  );
};
