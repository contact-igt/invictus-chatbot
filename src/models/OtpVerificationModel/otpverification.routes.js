import express from "express";
import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";
import {
    sendWhatsAppOTPController,
    verifyWhatsAppOTPController,
    checkWhatsAppOTPStatusController,
} from "./otpverification.controller.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

/**
 * POST /whatsapp-otp/send
 * Generate and send an OTP via an approved AUTHENTICATION WhatsApp template.
 * Body: { phone, template_id }
 */
router.post(
    "/whatsapp-otp/send",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    sendWhatsAppOTPController,
);

/**
 * POST /whatsapp-otp/verify
 * Verify a WhatsApp OTP code.
 * Body: { phone, otp }
 */
router.post(
    "/whatsapp-otp/verify",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    verifyWhatsAppOTPController,
);

/**
 * GET /whatsapp-otp/status/:phone
 * Check if a phone number has a recently verified WhatsApp OTP.
 */
router.get(
    "/whatsapp-otp/status/:phone",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    checkWhatsAppOTPStatusController,
);

export default router;
