import * as AppointmentService from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";
import db from "../../../database/index.js";

export const execute = async (payload, context) => {
  try {
    const { tenant_id, contact_id, phone, phone_number_id } = context;
    if (!payload) return;

    let data;
    try {
      data = JSON.parse(payload);
    } catch (parseErr) {
      console.error("[TAG-HANDLER-CANCEL-APPOINTMENT] Invalid JSON:", parseErr.message);
      return;
    }

    const { appointment_id } = data;

    if (!appointment_id) {
      const errMsg = "❌ I couldn't find the appointment ID to cancel. Please provide the appointment ID.";
      await sendWhatsAppMessage(tenant_id, phone, errMsg).catch(() => {});
      return;
    }

    console.log(`[TAG-HANDLER-CANCEL-APPOINTMENT] Cancelling ${appointment_id}`);
    
    await AppointmentService.deleteAppointmentService(tenant_id, appointment_id);

    const successMsg = `✅ *Appointment Cancelled*\n\nYour appointment *${appointment_id}* has been successfully cancelled.`;

    await sendWhatsAppMessage(tenant_id, phone, successMsg).catch(() => {});

    try {
      await createUserMessageService(
        tenant_id,
        contact_id,
        phone_number_id,
        phone,
        null,
        null,
        "bot",
        null,
        successMsg,
      );
    } catch (_) {}

  } catch (err) {
    console.error("[TAG-HANDLER-CANCEL-APPOINTMENT] Error:", err.message);
    const errorMsg = "❌ Sorry, I couldn't cancel your appointment right now. Please try via the dashboard or contact support.";
    await sendWhatsAppMessage(context.tenant_id, context.phone, errorMsg).catch(() => {});
  }
};
