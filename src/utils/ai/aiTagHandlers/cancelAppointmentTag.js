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
      console.error(
        "[TAG-HANDLER-CANCEL-APPOINTMENT] Invalid JSON:",
        parseErr.message,
      );
      return;
    }

    const { appointment_id } = data;

    // Check for placeholder values that AI might incorrectly use
    const placeholders = ["ID", "APPOINTMENT_ID", "AP_ID"];
    if (
      !appointment_id ||
      placeholders.includes(String(appointment_id).toUpperCase())
    ) {
      console.error(
        "[TAG-HANDLER-CANCEL-APPOINTMENT] Missing or placeholder appointment_id:",
        appointment_id,
      );
      const errMsg =
        "❌ I need your appointment ID to cancel it. Please tell me which appointment you want to cancel (e.g., AP001).";
      await sendWhatsAppMessage(tenant_id, phone, errMsg).catch(() => {});
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
          errMsg,
        );
      } catch (_) {}
      return;
    }

    console.log(
      `[TAG-HANDLER-CANCEL-APPOINTMENT] Cancelling ${appointment_id} for tenant ${tenant_id}`,
    );

    // Get appointment email before deletion for notification
    const appointment = await db.Appointments.findOne({
      where: { appointment_id, tenant_id, is_deleted: false },
      attributes: ["email", "patient_name"],
    });

    console.log(
      `[TAG-HANDLER-CANCEL-APPOINTMENT] Found appointment:`,
      appointment
        ? { id: appointment_id, email: appointment.email }
        : "NOT FOUND",
    );

    if (!appointment) {
      const notFoundMsg = `❌ I couldn't find appointment *${appointment_id}*. It may have already been cancelled or the ID is incorrect.`;
      await sendWhatsAppMessage(tenant_id, phone, notFoundMsg).catch(() => {});
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
          notFoundMsg,
        );
      } catch (_) {}
      return;
    }

    const appointmentEmail = appointment?.email;

    await AppointmentService.deleteAppointmentService(
      tenant_id,
      appointment_id,
    );

    // Add email note if email exists
    const emailNote = appointmentEmail
      ? `\n\n📧 Cancellation confirmation sent to: ${appointmentEmail}`
      : "";

    const successMsg = `✅ *Appointment Cancelled*\n\nYour appointment *${appointment_id}* has been successfully cancelled.${emailNote}`;

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

    // Determine appropriate error message based on error type
    let errorMsg;
    if (err.message.includes("not found")) {
      errorMsg = `❌ I couldn't find that appointment. It may have already been cancelled or the ID is incorrect.`;
    } else {
      errorMsg =
        "❌ Sorry, I couldn't cancel your appointment right now. Please try via the dashboard or contact support.";
    }

    await sendWhatsAppMessage(context.tenant_id, context.phone, errorMsg).catch(
      () => {},
    );

    // Also save error message to conversation history
    try {
      await createUserMessageService(
        context.tenant_id,
        context.contact_id,
        context.phone_number_id,
        context.phone,
        null,
        null,
        "bot",
        null,
        errorMsg,
      );
    } catch (_) {}
  }
};
