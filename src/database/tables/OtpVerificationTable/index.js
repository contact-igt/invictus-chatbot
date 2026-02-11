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
                allowNull: false,
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
                allowNull: false,
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
            ],
        }
    );
};
