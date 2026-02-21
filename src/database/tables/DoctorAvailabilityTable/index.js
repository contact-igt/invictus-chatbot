import { tableNames } from "../../tableName.js";

export const DoctorAvailabilityTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.DOCTOR_AVAILABILITY,
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
                    "monday", "tuesday", "wednesday", "thursday",
                    "friday", "saturday", "sunday"
                ),
                allowNull: false,
            },

            start_time: {
                type: Sequelize.STRING,
                allowNull: false,
                comment: "Format: HH:mm (e.g. 09:00)",
            },

            end_time: {
                type: Sequelize.STRING,
                allowNull: false,
                comment: "Format: HH:mm (e.g. 17:00)",
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
            tableName: tableNames.DOCTOR_AVAILABILITY,
            timestamps: true,
            underscored: true,
            indexes: [
                {
                    name: "idx_availability_doctor",
                    fields: ["doctor_id"],
                },
                {
                    name: "idx_availability_tenant",
                    fields: ["tenant_id"],
                },
            ],
        }
    );
};
