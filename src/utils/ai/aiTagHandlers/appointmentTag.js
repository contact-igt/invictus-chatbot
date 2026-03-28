import * as AppointmentService from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";
import {
  findDoctorByNameService,
  getDoctorAvailabilityService,
  getDoctorByIdService,
  getDoctorsForAIService,
} from "../../../models/DoctorModel/doctor.service.js";

export const execute = async (payload, context, cleanMessage) => {
  try {
    const { tenant_id, contact_id, phone, phone_number_id } = context;
    if (!payload) return;

    let data;
    try {
      data = JSON.parse(payload);
    } catch (parseErr) {
      const parseErrMsg =
        "❌ Could not process the booking details. Please confirm your appointment details again and I'll book it for you.";
      console.error(
        "[TAG-HANDLER-APPOINTMENT] Invalid JSON payload:",
        parseErr.message,
        "\nRaw payload:",
        payload?.substring(0, 200),
      );
      await sendWhatsAppMessage(tenant_id, phone, parseErrMsg).catch(() => {});
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
          parseErrMsg,
        );
      } catch (_) {}
      // Explicitly throw error so caller can handle it
      throw new Error(parseErrMsg);
    }

    // Strictly validate all required fields before proceeding
    // Note: email and problem are OPTIONAL - not required for WhatsApp bookings
    const requiredFields = [
      { key: "patient_name", label: "full name" },
      { key: "contact_number", label: "contact number" },
      { key: "age", label: "age" },
      { key: "date", label: "preferred date" },
      { key: "time", label: "preferred time" },
      { key: "doctor_id", label: "doctor selection" },
    ];
    // Fix: If contact_number is missing or a placeholder, use phone from context if available
    if (
      (!data.contact_number ||
        data.contact_number === "NUM" ||
        data.contact_number === "" ||
        data.contact_number === undefined) &&
      phone
    ) {
      data.contact_number = phone;
    }

    const placeholders = [
      "NAME",
      "NUM",
      "EMAIL",
      "AGE",
      "YYYY-MM-DD",
      "HH:MM AM/PM",
      "HH:MM AM",
      "ID",
      "DOC_NAME",
      "REASON",
    ];

    const missingFields = requiredFields.filter((f) => {
      const val = data[f.key];
      return (
        !val ||
        val === "" ||
        val === undefined ||
        placeholders.includes(String(val).toUpperCase())
      );
    });

    if (missingFields.length > 0) {
      const missingLabels = missingFields.map((f) => f.label).join(", ");
      const errorMsg = `❌ I'm missing the following information to complete your booking: ${missingLabels}.
Please provide these details.`;
      console.error(
        `[TAG-HANDLER-APPOINTMENT] Missing or placeholder fields: ${missingLabels}`,
      );
      await sendWhatsAppMessage(tenant_id, phone, errorMsg).catch((err) =>
        console.error(
          "[TAG-HANDLER-APPOINTMENT] WhatsApp send failed:",
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
          errorMsg,
        );
      } catch (_) {}
      // Exit without creating appointment
      return;
    }

    // ─── Resolve Doctor ID from Name if ID is a placeholder or looks like a name ───
    if (
      data.doctor_id === "ID" ||
      (data.doctor_name && data.doctor_id && data.doctor_id.length > 10)
    ) {
      const resolvedDoc = await findDoctorByNameService(
        tenant_id,
        data.doctor_name || data.doctor_id,
      );
      if (resolvedDoc) {
        data.doctor_id = resolvedDoc.doctor_id;
        console.log(
          `[TAG-HANDLER-APPOINTMENT] Resolved doctor_id to ${data.doctor_id} for ${data.doctor_name}`,
        );
      }
    }

    // ─── Pre-Booking Validation: Check DB for existing appointments ───
    const normalizeTime = (t) => {
      if (!t) return t;
      if (t.includes("AM") || t.includes("PM")) {
        const [tp, period] = t.trim().split(/\s+/);
        const [h, m] = tp.split(":");
        return `${parseInt(h, 10) < 10 ? "0" + parseInt(h, 10) : parseInt(h, 10)}:${m} ${period.toUpperCase()}`;
      }
      return t;
    };

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

    const normalizedTime = normalizeTime(data.time);

    if (contact_id && data.date) {
      try {
        const existingAppts =
          await AppointmentService.getActiveAppointmentsByContactService(
            tenant_id,
            contact_id,
          );

        if (existingAppts && existingAppts.length > 0) {
          const bookingDate = data.date; // Already YYYY-MM-DD from AI

          // Check 1: Same person, same date, same time (exact duplicate)
          const exactDupe = existingAppts.find((a) => {
            const aDate = toDateStr(a.appointment_date);
            return (
              aDate === bookingDate && a.appointment_time === normalizedTime
            );
          });

          if (exactDupe) {
            const dupeMsg =
              `⚠️ You already have an appointment on *${data.date}* at *${data.time}*` +
              `${exactDupe.doctor?.name ? ` with ${exactDupe.doctor.name}` : ""}` +
              ` (Token: #${exactDupe.token_number}).\n\n` +
              `Would you like to book for a different date/time instead?`;
            await sendWhatsAppMessage(tenant_id, phone, dupeMsg).catch(
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
                dupeMsg,
              );
            } catch (_) {}
            console.log(
              "[TAG-HANDLER-APPOINTMENT] Blocked: exact duplicate appointment",
            );
            return;
          }

          // Check 2: Same person, same doctor, same date (already seeing this doctor today)
          if (data.doctor_id) {
            const sameDoctorSameDay = existingAppts.find((a) => {
              const aDate = toDateStr(a.appointment_date);
              return aDate === bookingDate && a.doctor_id === data.doctor_id;
            });

            if (sameDoctorSameDay) {
              const docName =
                sameDoctorSameDay.doctor?.name || "the same doctor";
              const sameDayMsg =
                `⚠️ You already have an appointment with *${docName}* on *${data.date}* at *${sameDoctorSameDay.appointment_time}*` +
                ` (Token: #${sameDoctorSameDay.token_number}).\n\n` +
                `You cannot book another appointment with the same doctor on the same day.\n` +
                `Would you like to choose a different date or a different doctor?`;
              await sendWhatsAppMessage(tenant_id, phone, sameDayMsg).catch(
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
                  sameDayMsg,
                );
              } catch (_) {}
              console.log(
                "[TAG-HANDLER-APPOINTMENT] Blocked: same doctor same day",
              );
              return;
            }
          }
        }
      } catch (preCheckErr) {
        console.error(
          "[TAG-HANDLER-APPOINTMENT] Pre-check error (non-blocking):",
          preCheckErr.message,
        );
        // Non-blocking — continue to createAppointmentService which has its own duplicate check
      }
    }

    // ─── DATABASE VERIFICATION: Doctor Exists ───
    if (data.doctor_id) {
      const doctorExists = await getDoctorByIdService(
        data.doctor_id,
        tenant_id,
      );
      if (!doctorExists) {
        console.log(
          `[TAG-HANDLER-APPOINTMENT] Doctor not found in database: ${data.doctor_id}`,
        );
        // Fetch available doctors to show user
        let altDoctorsList = "";
        try {
          const doctorsList = await getDoctorsForAIService(tenant_id);
          if (doctorsList) {
            altDoctorsList = `\n\nAvailable doctors:\n${doctorsList}`;
          }
        } catch (_) {}

        const doctorNotFoundMsg =
          `❌ I couldn't find the doctor *${data.doctor_id}* in our system. ` +
          `This doctor may have been removed or the ID is incorrect.${altDoctorsList}\n\n` +
          `Please select a valid doctor and I'll book your appointment.`;
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
        return; // Do NOT proceed with booking
      }

      // Check doctor status (must be AVAILABLE)
      if (
        doctorExists.status &&
        doctorExists.status.toLowerCase() !== "available"
      ) {
        console.log(
          `[TAG-HANDLER-APPOINTMENT] Doctor ${data.doctor_id} status is ${doctorExists.status}`,
        );
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
        return; // Do NOT proceed with booking
      }
    }

    // ─── DATABASE VERIFICATION: Slot Availability ───
    if (data.doctor_id && data.date && data.time) {
      const isAvailable = await AppointmentService.checkAvailabilityService(
        tenant_id,
        data.doctor_id,
        data.date,
        data.time,
      );

      if (!isAvailable) {
        console.log(
          `[TAG-HANDLER-APPOINTMENT] Slot not available: ${data.doctor_id} on ${data.date} at ${data.time}`,
        );

        // Get alternative slots
        const slotsResult = await AppointmentService.getAvailableSlotsService(
          tenant_id,
          data.doctor_id,
          data.date,
        );

        let altMessage;
        if (slotsResult.slots && slotsResult.slots.length > 0) {
          const slotList = slotsResult.slots
            .slice(0, 8)
            .map((s) => `  🕐 ${s}`)
            .join("\n");
          altMessage =
            `❌ Sorry, the ${data.time} slot on ${data.date} is already booked.\n\n` +
            `Here are the available slots for that day:\n${slotList}\n\n` +
            `Please choose one of these times and I'll book it for you.`;
        } else {
          // Get doctor's available days to help user pick
          let availableDaysText = "";
          try {
            const availability = await getDoctorAvailabilityService(
              tenant_id,
              data.doctor_id,
            );
            if (availability && availability.length > 0) {
              const daysFormatted = availability
                .map((a) => {
                  const dayCapitalized =
                    a.day_of_week.charAt(0).toUpperCase() +
                    a.day_of_week.slice(1);
                  return `  📅 ${dayCapitalized}: ${a.start_time} – ${a.end_time}`;
                })
                .join("\n");
              availableDaysText = `\n\nThe doctor is available on:\n${daysFormatted}`;
            }
          } catch (_) {}

          altMessage =
            `❌ Sorry, the ${data.time} slot on ${data.date} is already booked, ` +
            `and there are no other available slots on this date.` +
            availableDaysText +
            `\n\nPlease choose a different date.`;
        }

        await sendWhatsAppMessage(tenant_id, phone, altMessage).catch((err) =>
          console.error(
            "[TAG-HANDLER-APPOINTMENT] WhatsApp send failed:",
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
        return; // Do NOT create the appointment
      }
    }

    // Ensure required fields are present
    const appointmentData = {
      tenant_id,
      contact_id,
      patient_name: data.patient_name || "Guest",
      contact_number: data.contact_number || phone,
      appointment_date: data.date,
      appointment_time: data.time,
      age: data.age || null,
      doctor_id: data.doctor_id || null,
      status: "Confirmed",
      email: data.email || null,
      notes: data.notes || data.problem || null, // Accept both "notes" and "problem" fields
    };

    console.log(
      `[TAG-HANDLER-APPOINTMENT] Executing for tenant ${tenant_id}, contact ${contact_id}`,
    );

    let appointment;
    try {
      appointment =
        await AppointmentService.createAppointmentService(appointmentData);
    } catch (err) {
      // Log and rethrow so the caller (playground or chat) can show the error
      console.error("[TAG-HANDLER-APPOINTMENT] DB error:", err.message);
      throw err;
    }

    console.log(
      `[TAG-HANDLER-APPOINTMENT] Successfully booked. ID: ${appointment.appointment_id}, Token: ${appointment.token_number}`,
    );

    // Note: Email confirmation is sent automatically by createAppointmentService
    // The email will be sent to: data.email or contact.email (looked up by service)

    // Send WhatsApp confirmation message
    const contactPhone = phone;
    if (contactPhone) {
      try {
        const problemNote = data.problem ? `\nReason: ${data.problem}` : "";
        const emailNote = data.email
          ? `\n📧 Confirmation sent to: ${data.email}`
          : "";
        const whatsappMsg =
          `✅ *Appointment Confirmed!*\n\n` +
          `👤 Patient: ${appointmentData.patient_name}\n` +
          `📅 Date: ${data.date}\n` +
          `🕐 Time: ${data.time}\n` +
          `${data.age ? `🔢 Age: ${data.age}\n` : ""}` +
          `🎟️ Token: *#${appointment.token_number}*` +
          `${problemNote}${emailNote}\n\n` +
          `Please arrive 10 minutes before your scheduled time. See you soon! 😊`;

        await sendWhatsAppMessage(tenant_id, contactPhone, whatsappMsg);
        // Store confirmation in conversation history
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
        console.log(
          `[TAG-HANDLER-APPOINTMENT] WhatsApp confirmation sent to ${contactPhone}`,
        );
      } catch (waErr) {
        console.error(
          "[TAG-HANDLER-APPOINTMENT] WhatsApp send error:",
          waErr.message,
        );
      }
    }
  } catch (err) {
    console.error("[TAG-HANDLER-APPOINTMENT] Execution error:", err.message);

    // Send specific error message based on what went wrong
    try {
      const { tenant_id, contact_id, phone, phone_number_id } = context;
      let errorMsg;

      if (err.message.includes("already have an appointment")) {
        errorMsg =
          "⚠️ *Duplicate Booking Found*\n\n" +
          err.message +
          "\n\nWould you like to manage your existing appointment or pick a different time?";
      } else if (err.message.includes("time slot is already booked")) {
        errorMsg =
          "⚠️ *Slot Unavailable*\n\n" +
          "It looks like that time slot was just taken. " +
          "Please pick another time from the list above and I'll book it for you immediately.";
      } else {
        errorMsg =
          "❌ *Booking Failed*\n\n" +
          'I encountered a technical issue while booking your appointment. Please try again or type "agent" to speak with our staff.';
      }

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
