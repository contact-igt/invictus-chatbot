import * as AppointmentService from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";
import { getDoctorByIdService } from "../../../models/DoctorModel/doctor.service.js";

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

    // ─── DATABASE VERIFICATION: Appointment Exists ───
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

      // If appointment doesn't exist, notify user with their actual appointments
      if (!existingAppt) {
        console.error(
          `[TAG-HANDLER-UPDATE-APPOINTMENT] Appointment ${data.appointment_id} not found in database`,
        );
        let apptListText = "";
        if (activeAppts && activeAppts.length > 0) {
          apptListText =
            "\n\nYour current appointments:\n" +
            activeAppts
              .map((a) => {
                const dateStr = new Date(a.appointment_date).toLocaleDateString(
                  "en-GB",
                  { day: "2-digit", month: "long", year: "numeric" },
                );
                return `  - *${a.appointment_id}* on ${dateStr} at ${a.appointment_time}`;
              })
              .join("\n");
        } else {
          apptListText = "\n\nYou don't have any active appointments.";
        }

        const notFoundMsg =
          `❌ I couldn't find appointment *${data.appointment_id}* in your records.${apptListText}\n\n` +
          `Please provide the correct appointment ID to update.`;
        await sendWhatsAppMessage(tenant_id, phone, notFoundMsg).catch(
          () => {},
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
            notFoundMsg,
          );
        } catch (_) {}
        return; // Exit early - appointment doesn't exist
      }
    } catch (fetchErr) {
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] Failed to fetch existing appointment:",
        fetchErr.message,
      );
    }

    // Safety check: If fetch failed and existingAppt is still null, exit early
    if (!existingAppt) {
      console.error(
        "[TAG-HANDLER-UPDATE-APPOINTMENT] Could not verify appointment existence, aborting update",
      );
      const errMsg =
        "❌ I'm having trouble verifying your appointment. Please try again in a moment.";
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

    // ─── DATABASE VERIFICATION: New Doctor Exists (if changing doctor) ───
    if (data.doctor_id && data.doctor_id !== existingAppt?.doctor_id) {
      const doctorExists = await getDoctorByIdService(
        data.doctor_id,
        tenant_id,
      );
      if (!doctorExists) {
        console.log(
          `[TAG-HANDLER-UPDATE-APPOINTMENT] New doctor not found in database: ${data.doctor_id}`,
        );
        const doctorNotFoundMsg =
          `❌ I couldn't find doctor *${data.doctor_id}* in our system. ` +
          `Please select a valid doctor for your appointment update.`;
        await sendWhatsAppMessage(tenant_id, phone, doctorNotFoundMsg).catch(
          () => {},
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
            doctorNotFoundMsg,
          );
        } catch (_) {}
        return; // Do NOT proceed with update
      }

      // Check doctor status
      if (
        doctorExists.status &&
        doctorExists.status.toLowerCase() !== "available"
      ) {
        const statusMsg =
          `❌ Sorry, *${doctorExists.name || "this doctor"}* is currently *${doctorExists.status}* and not available for bookings.\n\n` +
          `Please choose a different doctor.`;
        await sendWhatsAppMessage(tenant_id, phone, statusMsg).catch(() => {});
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
            statusMsg,
          );
        } catch (_) {}
        return;
      }
    }

    // Timezone-safe date extraction: DATEONLY returns "YYYY-MM-DD" strings,
    // so use string directly instead of parsing through new Date() which shifts by timezone
    const toDateStr = (d) => {
      if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) {
        return d.substring(0, 10); // Extract YYYY-MM-DD from string
      }
      // Fallback for Date objects: use local date parts to avoid UTC shift
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
    if (data.doctor_id) {
      // Get actual doctor name for the message
      let newDocName = data.doctor_id;
      try {
        const docInfo = await getDoctorByIdService(data.doctor_id, tenant_id);
        if (docInfo?.name) newDocName = docInfo.name;
      } catch (_) {}
      changes.push(`👨‍⚕️ New Doctor: ${newDocName}`);
    }

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
