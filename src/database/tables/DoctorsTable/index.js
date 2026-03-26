import { tableNames } from "../../tableName.js";

export const DoctorsTable = (sequelize, Sequelize) => {
    return sequelize.define(
        tableNames.DOCTORS,
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

            tenant_user_id: {
                type: Sequelize.STRING,
                allowNull: true,
                comment: "Link to tenant_users table",
            },

            title: {
                type: Sequelize.ENUM("Mr", "Mrs", "Dr", "Ms"),
                allowNull: true,
                defaultValue: "Mr",
            },

            name: {
                type: Sequelize.STRING,
                allowNull: false,
            },

            country_code: {
                type: Sequelize.STRING,
                allowNull: true,
            },

            mobile: {
                type: Sequelize.STRING,
                allowNull: true,
            },

            email: {
                type: Sequelize.STRING,
                allowNull: true,
                validate: { isEmail: true },
            },

            bio: {
                type: Sequelize.TEXT,
                allowNull: true,
            },

            profile_pic: {
                type: Sequelize.STRING,
                allowNull: true,
            },

            experience_years: {
                type: Sequelize.INTEGER,
                allowNull: true,
                defaultValue: 0,
            },

            qualification: {
                type: Sequelize.STRING,
                allowNull: true,
            },

            status: {
                type: Sequelize.ENUM("available", "busy", "off_duty"),
                allowNull: false,
                defaultValue: "available",
            },

            consultation_duration: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 30,
                comment: "Duration in minutes",
            },

            appointment_count: {
                type: Sequelize.INTEGER,
                allowNull: false,
                defaultValue: 0,
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
            tableName: tableNames.DOCTORS,
            timestamps: true,
            underscored: true,
            indexes: [
                {
                    name: "unique_doctor_id",
                    unique: true,
                    fields: ["doctor_id"],
                },
                {
                    name: "idx_doctor_tenant",
                    fields: ["tenant_id", "is_deleted"],
                },
                {
                    name: "idx_doctor_status",
                    fields: ["tenant_id", "status", "is_deleted"],
                },
            ],
        }
    );
};
