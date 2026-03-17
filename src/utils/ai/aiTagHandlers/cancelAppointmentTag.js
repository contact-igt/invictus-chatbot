import * as AppointmentService from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";

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
    
    // Fetch appointment details BEFORE deleting for email context
    const appointment = await db.Appointments.findOne({
      where: { appointment_id, tenant_id },
      include: [
        { model: db.Contacts, as: "contact", attributes: ["email", "name"] },
        { model: db.Doctors, as: "doctor", attributes: ["name"] }
      ]
    });

    if (!appointment) {
      console.error(`[TAG-HANDLER-CANCEL-APPOINTMENT] Appointment ${appointment_id} not found.`);
      return;
    }

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

    // Send email notification for cancellation
    const emailTo = appointment.contact?.email;
    if (emailTo) {
      const { sendEmail } = await import("../../email/emailService.js");
      const { buildAppointmentEmailHtml, buildAppointmentEmailSubject, formatAppointmentDate } = await import("../../email/appointmentEmailTemplate.js");

      try {
        const formattedDate = formatAppointmentDate(appointment.appointment_date);
        const emailHtml = buildAppointmentEmailHtml({
          type: "Cancelled",
          patientName: appointment.patient_name || appointment.contact?.name || "Patient",
          appointmentId: appointment.appointment_id,
          tokenNumber: appointment.token_number,
          date: formattedDate,
          time: appointment.appointment_time,
          doctorName: appointment.doctor?.name || null,
        });

        const subject = buildAppointmentEmailSubject({
          type: "Cancelled",
          appointmentId: appointment.appointment_id,
          tokenNumber: appointment.token_number,
          date: formattedDate,
          time: appointment.appointment_time,
        });

        await sendEmail({ to: emailTo, subject, html: emailHtml });
        console.log(`[TAG-HANDLER-CANCEL-APPOINTMENT] Cancellation email sent to ${emailTo}`);
      } catch (emailErr) {
        console.error("[TAG-HANDLER-CANCEL-APPOINTMENT] Email send error:", emailErr.message);
      }
    }

  } catch (err) {
    console.error("[TAG-HANDLER-CANCEL-APPOINTMENT] Error:", err.message);
    const errorMsg = "❌ Sorry, I couldn't cancel your appointment right now. Please try via the dashboard or contact support.";
    await sendWhatsAppMessage(context.tenant_id, context.phone, errorMsg).catch(() => {});
  }
};
