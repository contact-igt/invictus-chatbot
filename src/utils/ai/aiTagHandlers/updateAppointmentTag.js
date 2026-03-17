import * as AppointmentService from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";
import { sendEmail } from "../../email/emailService.js";
import {
  buildAppointmentEmailHtml,
  buildAppointmentEmailSubject,
  formatAppointmentDate,
} from "../../email/appointmentEmailTemplate.js";
import db from "../../../database/index.js";

export const execute = async (payload, context) => {
  try {
    const { tenant_id, contact_id, phone, phone_number_id } = context;
    console.log(
      "[TAG-HANDLER-UPDATE-APPOINTMENT] Starting with payload:",
      payload,
    );
    console.log("[TAG-HANDLER-UPDATE-APPOINTMENT] Context:", {
      tenant_id,
      contact_id,
      phone,
    });
    if (!payload) {
      console.error("[TAG-HANDLER-UPDATE-APPOINTMENT] No payload received");
      return;
    }

    let data;
    try {
      data = JSON.parse(payload);
    } catch (parseErr) {
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] Invalid JSON payload:",
        parseErr.message,
        "| Raw payload:",
        payload,
      );
      const errMsg =
        "❌ Could not process the update details. Please confirm your changes again.";
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

    console.log("[TAG-HANDLER-UPDATE-APPOINTMENT] Parsed data:", data);

    if (!data.appointment_id) {
      console.error("[TAG-HANDLER-UPDATE-APPOINTMENT] Missing appointment_id");
      const errMsg =
        "❌ Could not identify which appointment to update. Please provide your appointment ID.";
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

    // Build update fields from provided data
    const updateFields = {};
    if (data.date) updateFields.appointment_date = data.date;
    if (data.time) updateFields.appointment_time = data.time;
    if (data.doctor_id) updateFields.doctor_id = data.doctor_id;
    if (data.age) updateFields.age = data.age;

    // Fetch existing appointment to fill in missing values for availability check
    let existingAppt = null;
    if (data.date || data.time || data.doctor_id) {
      try {
        const activeAppts =
          await AppointmentService.getActiveAppointmentsByContactService(
            tenant_id,
            contact_id,
          );
        existingAppt = activeAppts?.find(
          (a) => a.appointment_id === data.appointment_id,
        );
      } catch (_) {}
    }

    // Timezone-safe date extraction (avoids UTC shift with toISOString)
    const toDateStr = (d) => {
      const dt = new Date(d);
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    };

    // Validate slot availability if date, time, or doctor is being changed
    const checkDate =
      data.date ||
      (existingAppt ? toDateStr(existingAppt.appointment_date) : null);
    const checkTime = data.time || existingAppt?.appointment_time;
    const checkDoctorId = data.doctor_id || existingAppt?.doctor_id;

    if (checkDate && checkTime && checkDoctorId) {
      const isAvailable = await AppointmentService.checkAvailabilityService(
        tenant_id,
        checkDoctorId,
        checkDate,
        checkTime,
      );

      if (!isAvailable) {
        const slotsResult = await AppointmentService.getAvailableSlotsService(
          tenant_id,
          checkDoctorId,
          checkDate,
        );

        let altMessage;
        if (slotsResult.slots && slotsResult.slots.length > 0) {
          const slotList = slotsResult.slots
            .slice(0, 8)
            .map((s) => `  🕐 ${s}`)
            .join("\n");
          altMessage =
            `❌ Sorry, the ${checkTime} slot on ${checkDate} is already booked.\n\n` +
            `Here are the available slots for that day:\n${slotList}\n\n` +
            `Please choose one of these times and I'll update your appointment.`;
        } else {
          altMessage =
            `❌ Sorry, the ${checkTime} slot on ${checkDate} is already booked, ` +
            `and there are no other available slots on this date.\n` +
            `Please choose a different date.`;
        }

        await sendWhatsAppMessage(tenant_id, phone, altMessage).catch((err) =>
          console.error(
            "[TAG-HANDLER-UPDATE-APPOINTMENT] WhatsApp send failed:",
            err.message,
          ),
        );
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
            altMessage,
          );
        } catch (_) {}
        return;
      }
    }

    console.log(
      `[TAG-HANDLER-UPDATE-APPOINTMENT] Updating ${data.appointment_id} for tenant ${tenant_id}`,
    );

    const updated = await AppointmentService.updateAppointmentService(
      tenant_id,
      data.appointment_id,
      updateFields,
    );

    if (!updated) {
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] Appointment not found:",
        data.appointment_id,
      );
      return;
    }

    console.log(
      `[TAG-HANDLER-UPDATE-APPOINTMENT] Successfully updated ${data.appointment_id}`,
    );

    // Send WhatsApp update confirmation
    const dateStr = data.date
      ? new Date(data.date).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        })
      : "";

    const changes = [];
    if (data.date) changes.push(`📅 New Date: ${dateStr}`);
    if (data.time) changes.push(`🕐 New Time: ${data.time}`);
    if (data.doctor_id) changes.push(`👨‍⚕️ New Doctor: Updated`);

    const whatsappMsg =
      `✅ *Appointment Updated!*\n\n` +
      `🎟️ Appointment: *${data.appointment_id}*\n` +
      `${changes.join("\n")}\n\n` +
      `Your appointment has been successfully updated. See you soon! 😊`;

    await sendWhatsAppMessage(tenant_id, phone, whatsappMsg).catch((err) =>
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] WhatsApp send failed:",
        err.message,
      ),
    );
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
        whatsappMsg,
      );
    } catch (_) {}

    // Send email notification for the update
    try {
      const contact = await db.Contacts.findOne({
        where: { contact_id, tenant_id },
        attributes: ["email", "name"],
      });

      const emailTo = data.email || contact?.email;
      if (emailTo) {
        const apptDate =
          updated.appointment_date || existingAppt?.appointment_date;
        const apptTime =
          updated.appointment_time || existingAppt?.appointment_time;
        const doctorName =
          updated.doctor?.name || existingAppt?.doctor?.name || null;
        const formattedDate = formatAppointmentDate(apptDate);

        const emailChanges = [];
        if (data.date)
          emailChanges.push(
            `Date changed to ${formatAppointmentDate(data.date)}`,
          );
        if (data.time) emailChanges.push(`Time changed to ${data.time}`);
        if (data.doctor_id) emailChanges.push(`Doctor updated`);

        const emailHtml = buildAppointmentEmailHtml({
          type: "Updated",
          patientName: updated.patient_name || contact?.name || "Patient",
          appointmentId: data.appointment_id,
          tokenNumber: updated.token_number,
          date: formattedDate,
          time: apptTime,
          doctorName,
          reason: updated.notes || null,
          changes: emailChanges,
        });

        const subject = buildAppointmentEmailSubject({
          type: "Updated",
          appointmentId: data.appointment_id,
          tokenNumber: updated.token_number,
          date: formattedDate,
          time: apptTime,
        });

        await sendEmail({ to: emailTo, subject, html: emailHtml });
        console.log(
          `[TAG-HANDLER-UPDATE-APPOINTMENT] Email sent to ${emailTo}`,
        );
      }
    } catch (emailErr) {
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] Email send error:",
        emailErr.message,
      );
    }
  } catch (err) {
    console.error(
      "[TAG-HANDLER-UPDATE-APPOINTMENT] Execution error:",
      err.message,
    );
    try {
      const { tenant_id, contact_id, phone, phone_number_id } = context;
      const errorMsg =
        '❌ Sorry, something went wrong while updating your appointment. Please try again or type "update appointment" to restart.';
      await sendWhatsAppMessage(tenant_id, phone, errorMsg).catch(() => {});
      await createUserMessageService(
        tenant_id,
        contact_id,
        phone_number_id,
        phone,
        null,
        null,
        "bot",
        null,
        errorMsg,
      ).catch(() => {});
    } catch (_) {}
  }
};
