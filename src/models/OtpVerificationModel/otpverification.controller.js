import {
    generateWhatsAppOTPService,
    verifyWhatsAppOTPService,
    checkWhatsAppOTPStatusService,
} from "./otpverification.service.js";
import { sendWhatsAppTemplate } from "../AuthWhatsapp/AuthWhatsapp.service.js";
import { tableNames } from "../../database/tableName.js";
import db from "../../database/index.js";
import { createUserMessageService } from "../Messages/messages.service.js";
import {
    createLiveChatService,
    getLivechatByIdService,
    updateLiveChatTimestampService,
} from "../LiveChatModel/livechat.service.js";
import {
    createContactService,
    getContactByPhoneAndTenantIdService,
} from "../ContactsModel/contacts.service.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";

/**
 * POST /whatsapp-otp/send
 * Generates an OTP and sends it to a phone number using.
 * an approved AUTHENTICATION WhatsApp template.
 *
 * Body: { phone, template_id }
 */
export const sendWhatsAppOTPController = async (req, res) => {
    try {
        const tenant_id = req.user.tenant_id;
        const { phone, template_id } = req.body;

        if (!phone || !template_id) {
            return res.status(400).json({ message: "phone and template_id are required" });
        }

        const formattedPhone = formatPhoneNumber(phone);

        // Fetch the template to verify it's an auth template and is approved
        const [[template]] = await db.sequelize.query(
            `SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE} WHERE template_id = ? AND tenant_id = ? AND is_deleted = false`,
            { replacements: [template_id, tenant_id] }
        );

        if (!template) {
            return res.status(404).json({ message: "Template not found" });
        }

        if (template.category.toLowerCase() !== 'authentication') {
            return res.status(400).json({ message: "Only AUTHENTICATION category templates can be used for OTP sending" });
        }

        if (template.status !== 'approved') {
            return res.status(400).json({ message: `Template is not approved (current status: ${template.status}). Only approved templates can be sent.` });
        }

        // Generate OTP and store in DB
        const otp = await generateWhatsAppOTPService(formattedPhone, template.template_name);

        // Build the component parameter — {{1}} = OTP code
        const components = [
            {
                type: "body",
                parameters: [
                    { type: "text", text: otp }
                ]
            }
        ];

        // Send via Meta WhatsApp API
        const result = await sendWhatsAppTemplate(
            tenant_id,
            formattedPhone,
            template.template_name,
            template.language,
            components
        );

        // Ensure contact exists for chat history
        let contactId = null;
        try {
            const existingContact = await getContactByPhoneAndTenantIdService(tenant_id, formattedPhone);
            if (existingContact) {
                contactId = existingContact.contact_id;
            } else {
                const newContact = await createContactService(tenant_id, formattedPhone, null, null);
                contactId = newContact?.contact_id || null;
            }
        } catch (contactErr) {
            console.warn("[OTP-SEND] Could not resolve contact:", contactErr.message);
        }

        // Log to messages table
        if (contactId && result.meta_message_id) {
            await createUserMessageService(
                tenant_id,
                contactId,
                result.phone_number_id,
                formattedPhone,
                result.meta_message_id,
                "System",
                "admin",
                null,
                `[OTP Sent via ${template.template_name}]`,
                "template",
                null,
                null,
                "sent",
                template.template_name,
            );

            // Activate Live Chat
            const livelist = await getLivechatByIdService(tenant_id, contactId);
            if (!livelist) {
                await createLiveChatService(tenant_id, contactId);
            } else {
                await updateLiveChatTimestampService(tenant_id, contactId);
            }
        }

        return res.status(200).json({
            message: "OTP sent successfully",
            data: {
                phone: formattedPhone,
                meta_message_id: result.meta_message_id,
                expires_in: "10 minutes",
            }
        });
    } catch (err) {
        console.error("[OTP-SEND] Error:", err.message);
        return res.status(500).json({ message: err.message });
    }
};

/**
 * POST /whatsapp-otp/verify
 * Verifies a WhatsApp OTP code submitted by the user.
 *
 * Body: { phone, otp }
 */
export const verifyWhatsAppOTPController = async (req, res) => {
    try {
        const { phone, otp } = req.body;

        if (!phone || !otp) {
            return res.status(400).json({ message: "phone and otp are required" });
        }

        const formattedPhone = formatPhoneNumber(phone);
        const result = await verifyWhatsAppOTPService(formattedPhone, otp);

        if (!result.valid) {
            return res.status(400).json({ message: result.message });
        }

        return res.status(200).json({
            message: result.message,
            data: { phone: formattedPhone, verified: true }
        });
    } catch (err) {
        console.error("[OTP-VERIFY] Error:", err.message);
        return res.status(500).json({ message: err.message });
    }
};

/**
 * GET /whatsapp-otp/status/:phone
 * Check if a phone number has a recently verified OTP (within 15 min).
 */
export const checkWhatsAppOTPStatusController = async (req, res) => {
    try {
        const { phone } = req.params;
        if (!phone) {
            return res.status(400).json({ message: "phone is required" });
        }

        const formattedPhone = formatPhoneNumber(phone);
        const result = await checkWhatsAppOTPStatusService(formattedPhone);

        return res.status(200).json({
            message: "Status fetched",
            data: result
        });
    } catch (err) {
        console.error("[OTP-STATUS] Error:", err.message);
        return res.status(500).json({ message: err.message });
    }
};
