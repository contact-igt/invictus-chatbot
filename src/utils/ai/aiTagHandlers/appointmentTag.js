import * as AppointmentService from "../../../models/AppointmentModel/appointment.service.js";
import { sendWhatsAppMessage } from "../../../models/AuthWhatsapp/AuthWhatsapp.service.js";
import { sendEmail } from "../../email/emailService.js";
import {
  buildAppointmentEmailHtml,
  buildAppointmentEmailSubject,
  formatAppointmentDate,
} from "../../email/appointmentEmailTemplate.js";
import { createUserMessageService } from "../../../models/Messages/messages.service.js";
import db from "../../../database/index.js";

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
    const requiredFields = [
      { key: "patient_name", label: "full name" },
      { key: "contact_number", label: "contact number" },
      { key: "email", label: "email address" },
      { key: "age", label: "age" },
      { key: "date", label: "preferred date" },
      { key: "time", label: "preferred time" },
      { key: "doctor_id", label: "doctor selection" },
      { key: "problem", label: "reason for visit" },
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

    const missingFields = requiredFields.filter(
      (f) => !data[f.key] || data[f.key] === "",
    );
    if (missingFields.length > 0) {
      const missingLabels = missingFields.map((f) => f.label).join(", ");
      const errorMsg = `❌ I'm missing the following information to complete your booking: ${missingLabels}.
Please provide these details.`;
      console.error(
        `[TAG-HANDLER-APPOINTMENT] Missing required fields: ${missingLabels}`,
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
      // Explicitly throw error so caller can handle it
      throw new Error(errorMsg);
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

    // Timezone-safe date extraction (avoids UTC shift with toISOString)
    const toDateStr = (d) => {
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

    // ─── Availability Check Before Booking ───
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
          altMessage =
            `❌ Sorry, the ${data.time} slot on ${data.date} is already booked, ` +
            `and there are no other available slots on this date.\n` +
            `Please choose a different date.`;
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
      notes: data.problem || null,
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

    // Send email confirmation
    try {
      const contact = await db.Contacts.findOne({
        where: { contact_id, tenant_id },
        attributes: ["email"],
      });

      const emailTo = data.email || contact?.email;
      if (emailTo) {
        let doctorName = null;
        if (appointment.doctor_id) {
          // Fetch doctor name from DB
          try {
            const doctor = await db.Doctors.findOne({
              where: { doctor_id: appointment.doctor_id, tenant_id },
              attributes: ["name", "title"],
            });
            if (doctor) {
              doctorName = doctor.title
                ? `${doctor.title} ${doctor.name}`
                : doctor.name;
            }
          } catch (err) {
            console.error(
              "[TAG-HANDLER-APPOINTMENT] Could not fetch doctor name for email:",
              err.message,
            );
          }
        }
        // fallback to data.doctor_name or null
        if (!doctorName) doctorName = data.doctor_name || null;
        const formattedDate = formatAppointmentDate(data.date);

        const emailHtml = buildAppointmentEmailHtml({
          type: "Confirmed",
          patientName: appointmentData.patient_name,
          appointmentId: appointment.appointment_id,
          tokenNumber: appointment.token_number,
          date: formattedDate,
          time: data.time,
          doctorName,
          reason: data.problem || null,
        });

        const subject = buildAppointmentEmailSubject({
          type: "Confirmed",
          appointmentId: appointment.appointment_id,
          tokenNumber: appointment.token_number,
          date: formattedDate,
          time: data.time,
        });

        await sendEmail({ to: emailTo, subject, html: emailHtml });
        console.log(
          `[TAG-HANDLER-APPOINTMENT] Confirmation email sent to ${emailTo}`,
        );
      }
    } catch (emailErr) {
      console.error(
        "[TAG-HANDLER-APPOINTMENT] Email send error:",
        emailErr.message,
      );
    }

    // Send WhatsApp confirmation message
    const contactPhone = phone;
    if (contactPhone) {
      try {
        const problemNote = data.problem ? `\nReason: ${data.problem}` : "";
        const whatsappMsg =
          `✅ *Appointment Confirmed!*\n\n` +
          `👤 Patient: ${appointmentData.patient_name}\n` +
          `📅 Date: ${data.date}\n` +
          `🕐 Time: ${data.time}\n` +
          `${data.age ? `🔢 Age: ${data.age}\n` : ""}` +
          `🎟️ Token: *#${appointment.token_number}*` +
          `${problemNote}\n\n` +
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
