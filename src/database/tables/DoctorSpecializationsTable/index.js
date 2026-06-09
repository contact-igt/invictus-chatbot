import { tableNames } from "../../tableName.js";

export const DoctorSpecializationsTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.DOCTOR_SPECIALIZATIONS,
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

            specialization_id: {
                type: Sequelize.STRING,
                allowNull: false,
            },
        },
        {
            tableName: tableNames.DOCTOR_SPECIALIZATIONS,
            timestamps: false,
            underscored: true,
            indexes: [
                {
                    name: "unique_doctor_specialization",
                    unique: true,
                    fields: ["doctor_id", "specialization_id"],
                },
                {
                    name: "idx_ds_doctor",
                    fields: ["doctor_id"],
                },
                {
                    name: "idx_ds_specialization",
                    fields: ["specialization_id"],
                },
            ],
        }
    );
};
