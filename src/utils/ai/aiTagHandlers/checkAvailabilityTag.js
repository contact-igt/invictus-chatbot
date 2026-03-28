import { getAvailableSlotsService } from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";
import {
  findDoctorByNameService,
  getDoctorAvailabilityService,
} from "../../../models/DoctorModel/doctor.service.js";

export const execute = async (payload, context, cleanMessage) => {
  try {
    const { tenant_id, contact_id, phone, phone_number_id } = context;
    if (!payload) return;

    let data;
    try {
      data = JSON.parse(payload);
    } catch (parseErr) {
      console.error(
        "[TAG-HANDLER-CHECK_AVAILABILITY] Invalid JSON payload:",
        parseErr.message,
      );
      const errMsg =
        "❌ Could not process availability check. Please tell me the doctor name and date again.";
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
    const { doctor_id, date, doctor_name, preferred_time } = data;

    const placeholders = ["ID", "YYYY-MM-DD", "DOC_NAME", "NAME"];
    if (
      !doctor_id ||
      !date ||
      placeholders.includes(String(doctor_id).toUpperCase()) ||
      placeholders.includes(String(date).toUpperCase())
    ) {
      // Try to resolve doctor ID from name if doctor_id is a placeholder but name is provided
      if (
        (doctor_id === "ID" ||
          !doctor_id ||
          (doctor_name && doctor_id && doctor_id.length > 10)) &&
        doctor_name &&
        !placeholders.includes(doctor_name.toUpperCase())
      ) {
        const resolvedDoc = await findDoctorByNameService(
          tenant_id,
          doctor_name,
        );
        if (resolvedDoc) {
          data.doctor_id = resolvedDoc.doctor_id;
          // Re-assign local doctor_id for the rest of the function
          const newDocId = resolvedDoc.doctor_id;
          console.log(
            `[TAG-HANDLER-CHECK_AVAILABILITY] Resolved doctor_id to ${newDocId} for ${doctor_name}`,
          );
          return execute(
            JSON.stringify({ ...data, doctor_id: newDocId }),
            context,
            cleanMessage,
          );
        }
      }

      console.error(
        "[TAG-HANDLER-CHECK_AVAILABILITY] Missing or placeholder doctor_id/date",
      );
      const errMsg =
        "❌ I need both the doctor name and date to check availability. Please provide both.";
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
      `[TAG-HANDLER-CHECK_AVAILABILITY] Checking slots for doctor ${doctor_id} on ${date}`,
    );

    const result = await getAvailableSlotsService(tenant_id, doctor_id, date);

    let message;
    // Handle "Doctor not found" case first
    if (
      !result.available &&
      result.reason === "Doctor not found in our system"
    ) {
      message =
        `📅 *Availability Check*\n\n` +
        `❌ I couldn't find this doctor (${doctor_name || doctor_id}) in our system.\n\n` +
        `Please select a valid doctor from our available doctors list.`;
    } else if (!result.available && result.reason) {
      // Doctor doesn't work on this day - show their actual available days
      const availability = await getDoctorAvailabilityService(
        tenant_id,
        doctor_id,
      );
      let availableDaysText = "";
      if (availability && availability.length > 0) {
        const daysFormatted = availability
          .map((a) => {
            const dayCapitalized =
              a.day_of_week.charAt(0).toUpperCase() + a.day_of_week.slice(1);
            return `  📅 ${dayCapitalized}: ${a.start_time} – ${a.end_time}`;
          })
          .join("\n");
        availableDaysText = `\n\n*Available Days:*\n${daysFormatted}\n\nPlease choose one of these days.`;
      }

      message =
        `📅 *Availability Check*\n\n` +
        `${doctor_name ? `Doctor: ${doctor_name}\n` : ""}` +
        `Requested Date: ${date} (${result.day || ""})\n\n` +
        `❌ The doctor is not available on this day.` +
        availableDaysText;
    } else if (!result.available) {
      // All slots booked - show doctor's available days to help user pick another date
      const availability = await getDoctorAvailabilityService(
        tenant_id,
        doctor_id,
      );
      let availableDaysText = "";
      if (availability && availability.length > 0) {
        const daysFormatted = availability
          .map((a) => {
            const dayCapitalized =
              a.day_of_week.charAt(0).toUpperCase() + a.day_of_week.slice(1);
            return `  📅 ${dayCapitalized}: ${a.start_time} – ${a.end_time}`;
          })
          .join("\n");
        availableDaysText = `\n\n*Doctor's Available Days:*\n${daysFormatted}`;
      }

      message =
        `📅 *Availability Check*\n\n` +
        `${doctor_name ? `Doctor: ${doctor_name}\n` : ""}` +
        `Date: ${date}\n\n` +
        `❌ All slots are fully booked for this date.` +
        availableDaysText +
        `\n\nPlease choose a different date.`;
    } else {
      // Show available slots with numbers for easy selection
      const numberEmojis = [
        "1️⃣",
        "2️⃣",
        "3️⃣",
        "4️⃣",
        "5️⃣",
        "6️⃣",
        "7️⃣",
        "8️⃣",
        "9️⃣",
        "🔟",
      ];
      const slotList = result.slots
        .map((s, i) => `  ${numberEmojis[i] || `${i + 1}.`} ${s}`)
        .join("\n");

      if (preferred_time && result.slots.includes(preferred_time)) {
        message =
          `📅 *Time Available!*\n\n` +
          `I've checked, and *${preferred_time}* is available with ${doctor_name || "the doctor"} on ${date}.\n\n` +
          `Shall I go ahead and book this for you?`;
      } else if (preferred_time) {
        message =
          `📅 *Slot Unavailable*\n\n` +
          `I'm sorry, but *${preferred_time}* is not available on ${date}.\n\n` +
          `*Available Slots:*\n${slotList}\n\n` +
          `Please reply with the slot number or time you prefer.`;
      } else {
        message =
          `📅 *Available Slots*\n\n` +
          `${doctor_name ? `Doctor: ${doctor_name}\n` : ""}` +
          `Date: ${date} (${result.day})\n` +
          `Available: ${result.slots.length} of ${result.totalSlots} slots\n\n` +
          `${slotList}\n\n` +
          `Reply with the slot number (1, 2, 3...) or time (e.g., "09:00 AM") to book.`;
      }
    }

    await sendWhatsAppMessage(tenant_id, phone, message).catch((err) =>
      console.error(
        "[TAG-HANDLER-CHECK_AVAILABILITY] WhatsApp send failed:",
        err.message,
      ),
    );

    // Store slots message in conversation history so AI remembers it
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
        message,
      );
    } catch (storeErr) {
      console.error(
        "[TAG-HANDLER-CHECK_AVAILABILITY] Failed to store message:",
        storeErr.message,
      );
    }

    console.log(
      `[TAG-HANDLER-CHECK_AVAILABILITY] Sent availability info to ${phone}`,
    );
  } catch (err) {
    console.error("[TAG-HANDLER-CHECK_AVAILABILITY] Error:", err.message);
    try {
      const { tenant_id, contact_id, phone, phone_number_id } = context;
      const errorMsg =
        "❌ Sorry, I couldn't check availability right now. Please try again.";
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
