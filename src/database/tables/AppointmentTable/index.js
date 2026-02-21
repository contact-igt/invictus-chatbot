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
                unique: true,
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

            appointment_date: {
                type: Sequelize.DATEONLY,
                allowNull: false,
            },

            appointment_time: {
                type: Sequelize.TIME,
                allowNull: false,
            },

            status: {
                type: Sequelize.ENUM("Pending", "Confirmed", "Completed", "Cancelled", "Noshow"),
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
                    name: "idx_appointment_tenant",
                    fields: ["tenant_id", "status"],
                },
                {
                    name: "idx_appointment_date",
                    fields: ["appointment_date", "appointment_time"],
                },
                {
                    name: "idx_appointment_contact",
                    fields: ["contact_id"],
                },
            ],
        }
    );
};
