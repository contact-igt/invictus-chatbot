import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import fs from "fs";
import path from "path";
import handlebars from "handlebars";
import { fileURLToPath } from "url";
import { sendEmail } from "../../utils/email/emailService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate a 6-digit OTP
export const generateOTPCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Save OTP to database
export const generateOTPService = async (email, user_type) => {
    try {
        const otp = generateOTPCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Invalidate any existing OTPs for this email using Sequelize
        await db.OtpVerification.update(
            { is_verified: true },
            { where: { email, user_type, is_verified: false } }
        );

        // Insert new OTP using Sequelize
        await db.OtpVerification.create({
            email,
            otp,
            expires_at: expiresAt,
            user_type
        });

        // Send OTP email
        const templatePath = path.join(
            __dirname,
            "../../../public/html/passwordResetOTP/index.html"
        );

        const source = fs.readFileSync(templatePath, "utf8");
        const template = handlebars.compile(source);

        const emailHtml = template({ email, otp });

        await sendEmail({
            to: email,
            subject: "Password Reset OTP - WhatsNexus",
            html: emailHtml,
        });

        return { success: true };
    } catch (err) {
        throw err;
    }
};

// Verify OTP
export const verifyOTPService = async (email, otp, user_type) => {
    try {
        const otpRecord = await db.OtpVerification.findOne({
            where: { email, otp, user_type, is_verified: false },
            order: [['created_at', 'DESC']]
        });

        if (!otpRecord) {
            return { valid: false, message: "Invalid or already used OTP" };
        }

        // Check expiration
        if (new Date() > new Date(otpRecord.expires_at)) {
            return { valid: false, message: "OTP has expired" };
        }

        // Mark as verified
        await otpRecord.update({ is_verified: true });

        return { valid: true, message: "OTP verified successfully" };
    } catch (err) {
        throw err;
    }
};

// Check if OTP was recently verified for an email
export const checkOTPVerificationService = async (email, user_type) => {
    try {
        const row = await db.OtpVerification.findOne({
            where: {
                email,
                user_type,
                is_verified: true,
                created_at: {
                    [db.Sequelize.Op.gt]: new Date(Date.now() - 15 * 60 * 1000)
                }
            },
            order: [['created_at', 'DESC']]
        });

        return !!row;
    } catch (err) {
        throw err;
    }
};
