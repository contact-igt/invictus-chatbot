import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { getTemplate } from "../../utils/email/templateLoader.js";
import { sendEmail } from "../../utils/email/emailService.js";

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
        const template = getTemplate("passwordResetOTP");

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

// ─────────────────────────────────────────
// WHATSAPP OTP FUNCTIONS
// ─────────────────────────────────────────

/**
 * Generate a WhatsApp OTP for a phone number.
 * Invalidates any existing unverified WhatsApp OTPs for the same phone.
 * Returns the plain OTP string to be embedded in the WhatsApp template variable {{1}}.
 */
export const generateWhatsAppOTPService = async (phone, template_name) => {
    try {
        const otp = generateOTPCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Invalidate any previous unverified WhatsApp OTPs for this phone
        await db.OtpVerification.update(
            { is_verified: true },
            { where: { phone, channel: 'whatsapp', is_verified: false } }
        );

        // Store the new OTP
        await db.OtpVerification.create({
            phone,
            otp,
            expires_at: expiresAt,
            channel: 'whatsapp',
            template_name: template_name || null,
        });

        return otp; // Return plain OTP to embed in template as {{1}}
    } catch (err) {
        throw err;
    }
};

/**
 * Verify a WhatsApp OTP submitted by a user.
 * Returns { valid: boolean, message: string }
 */
export const verifyWhatsAppOTPService = async (phone, otp) => {
    try {
        const otpRecord = await db.OtpVerification.findOne({
            where: { phone, otp, channel: 'whatsapp', is_verified: false },
            order: [['created_at', 'DESC']]
        });

        if (!otpRecord) {
            return { valid: false, message: "Invalid or already used OTP" };
        }

        if (new Date() > new Date(otpRecord.expires_at)) {
            return { valid: false, message: "OTP has expired" };
        }

        await otpRecord.update({ is_verified: true });

        return { valid: true, message: "OTP verified successfully" };
    } catch (err) {
        throw err;
    }
};

/**
 * Check whether a phone's last WhatsApp OTP was recently verified (within 15 min).
 */
export const checkWhatsAppOTPStatusService = async (phone) => {
    try {
        const row = await db.OtpVerification.findOne({
            where: {
                phone,
                channel: 'whatsapp',
                is_verified: true,
                created_at: {
                    [db.Sequelize.Op.gt]: new Date(Date.now() - 15 * 60 * 1000)
                }
            },
            order: [['created_at', 'DESC']]
        });

        return { verified: !!row, record: row || null };
    } catch (err) {
        throw err;
    }
};
