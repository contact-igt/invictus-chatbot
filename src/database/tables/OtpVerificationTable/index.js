import { tableNames } from "../../tableName.js";

export const OtpVerificationTable = (sequelize, Sequelize) => {
    return sequelize.define(
        "OtpVerification",
        {
            id: {
                type: Sequelize.INTEGER,
                allowNull: false,
                autoIncrement: true,
                primaryKey: true,
            },

            email: {
                type: Sequelize.STRING,
                allowNull: true,
            },

            phone: {
                type: Sequelize.STRING(20),
                allowNull: true,
            },

            otp: {
                type: Sequelize.STRING(6),
                allowNull: false,
            },

            expires_at: {
                type: Sequelize.DATE,
                allowNull: false,
            },

            is_verified: {
                type: Sequelize.BOOLEAN,
                defaultValue: false,
                allowNull: false,
            },

            user_type: {
                type: Sequelize.ENUM("tenant", "management"),
                allowNull: true,
            },

            channel: {
                type: Sequelize.ENUM("email", "whatsapp"),
                allowNull: false,
                defaultValue: "email",
            },

            template_name: {
                type: Sequelize.STRING(255),
                allowNull: true,
            },

            createdAt: {
                type: Sequelize.DATE,
                allowNull: false,
                defaultValue: sequelize.literal("CURRENT_TIMESTAMP"),
                field: "created_at",
            },
        },
        {
            tableName: tableNames.OTP_VERIFICATIONS,
            timestamps: false, // Disabling default timestamps as we only need created_at
            underscored: true,
            indexes: [
                {
                    name: "idx_otp_email_type",
                    fields: ["email", "user_type"],
                },
                {
                    name: "idx_otp_verified",
                    fields: ["is_verified"],
                },
                // NOTE: idx_otp_phone_channel is created via migrations/add_whatsapp_otp_columns.sql
                // Do NOT define it here — Sequelize sync() will crash if 'phone'/'channel' columns
                // don't exist in the live DB yet.
            ],
        }
    );
};
