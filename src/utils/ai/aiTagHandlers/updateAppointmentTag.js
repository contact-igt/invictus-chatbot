import * as AppointmentService from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";

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

    // Check for placeholder values that AI might incorrectly use
    const placeholders = ["ID", "YYYY-MM-DD", "HH:MM AM/PM", "HH:MM", "DOC_ID"];
    if (
      !data.appointment_id ||
      placeholders.includes(String(data.appointment_id).toUpperCase())
    ) {
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] Missing or placeholder appointment_id:",
        data.appointment_id,
      );
      const errMsg =
        "❌ I need your appointment ID to update it. Please tell me which appointment you want to update (e.g., AP001).";
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

    console.log(
      "[TAG-HANDLER-UPDATE-APPOINTMENT] Update fields:",
      updateFields,
    );

    // Check if there's anything to update
    if (Object.keys(updateFields).length === 0) {
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] No update fields provided",
      );
      const errMsg =
        "❌ I didn't receive any changes to make. Please tell me what you'd like to update (date, time, or doctor).";
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

    // Fetch existing appointment to fill in missing values for availability check
    let existingAppt = null;
    try {
      const activeAppts =
        await AppointmentService.getActiveAppointmentsByContactService(
          tenant_id,
          contact_id,
        );
      existingAppt = activeAppts?.find(
        (a) => a.appointment_id === data.appointment_id,
      );
      console.log(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] Existing appointment found:",
        existingAppt?.appointment_id || "NOT FOUND",
      );
    } catch (fetchErr) {
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] Failed to fetch existing appointment:",
        fetchErr.message,
      );
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
      // Pass the appointment_id to exclude it from availability check (since we're updating it)
      const isAvailable = await AppointmentService.checkAvailabilityService(
        tenant_id,
        checkDoctorId,
        checkDate,
        checkTime,
        data.appointment_id, // Exclude this appointment from conflict check
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
      const notFoundMsg = `❌ I couldn't find appointment *${data.appointment_id}*. Please check the ID and try again.`;
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

    // Add email notification note if email exists
    const emailNote = updated.email
      ? `\n📧 Update confirmation sent to: ${updated.email}`
      : "";

    const whatsappMsg =
      `✅ *Appointment Updated!*\n\n` +
      `🎟️ Appointment: *${data.appointment_id}*\n` +
      `${changes.join("\n")}\n\n` +
      `Your appointment has been successfully updated. See you soon! 😊` +
      emailNote;

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

    // Confirmation message already sent via WhatsApp and stored in message history above
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
