import { tableNames } from "../../tableName.js";

export const DoctorAvailabilityDayTable = (sequelize, Sequelize) => {
  return sequelize.define(
    tableNames.DOCTOR_AVAILABILITY_DAYS,
    {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },

      doctor_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },

      day_of_week: {
        type: Sequelize.ENUM(
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ),
        allowNull: false,
      },

      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      slot_duration: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 15,
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
      tableName: tableNames.DOCTOR_AVAILABILITY_DAYS,
      timestamps: true,
      underscored: true,
      indexes: [
        {
          name: "unique_doctor_availability_day",
          unique: true,
          fields: ["tenant_id", "doctor_id", "day_of_week"],
        },
        {
          name: "idx_availability_day_doctor",
          fields: ["doctor_id"],
        },
        {
          name: "idx_availability_day_tenant",
          fields: ["tenant_id"],
        },
      ],
    },
  );
};
