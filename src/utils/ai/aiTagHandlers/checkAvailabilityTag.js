import { getAvailableSlotsService } from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";

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

    if (!doctor_id || !date) {
      console.error(
        "[TAG-HANDLER-CHECK_AVAILABILITY] Missing doctor_id or date",
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
    if (!result.available && result.reason) {
      // Doctor doesn't work on this day
      message =
        `📅 *Availability Check*\n\n` +
        `${doctor_name ? `Doctor: ${doctor_name}\n` : ""}` +
        `Date: ${date} (${result.day || ""})\n\n` +
        `❌ The doctor is not available on this day.\n` +
        `Please choose a different date when the doctor is scheduled.`;
    } else if (!result.available) {
      // All slots booked
      message =
        `📅 *Availability Check*\n\n` +
        `${doctor_name ? `Doctor: ${doctor_name}\n` : ""}` +
        `Date: ${date}\n\n` +
        `❌ All slots are fully booked for this date.\n` +
        `Please choose a different date.`;
    } else {
      // Show available slots
      const slotList = result.slots.map((s) => `  🕐 ${s}`).join("\n");
      
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
          `Please choose a different time from the list above.`;
      } else {
        message =
          `📅 *Available Slots*\n\n` +
          `${doctor_name ? `Doctor: ${doctor_name}\n` : ""}` +
          `Date: ${date} (${result.day})\n` +
          `Available: ${result.slots.length} of ${result.totalSlots} slots\n\n` +
          `${slotList}\n\n` +
          `Please choose a time from the available slots above.`;
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
