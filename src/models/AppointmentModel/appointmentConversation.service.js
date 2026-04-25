import { randomUUID } from "crypto";
import db from "../../database/index.js";
import { callAI } from "../../utils/ai/coreAi.js";
import {
  createAppointmentService,
  checkAvailabilityService,
  getAvailableSlotsService,
  updateAppointmentService,
  deleteAppointmentService,
  getActiveAppointmentsByContactService,
} from "./appointment.service.js";
import {
  getDoctorListService,
  findDoctorByNameService,
} from "../DoctorModel/doctor.service.js";
import { getIO } from "../../middlewares/socket/socket.js"; // NEW

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDateLong = (dateStr) => {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
};

const resolveAbsoluteDate = (raw) => {
  if (!raw) return null;
  const today = new Date();
  const lower = raw.toLowerCase().trim();

  if (lower === "today") return today.toISOString().slice(0, 10);
  if (lower === "tomorrow") {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  // "in N days"
  const inDays = lower.match(/^in\s+(\d+)\s+days?$/);
  if (inDays) {
    const d = new Date(today);
    d.setDate(d.getDate() + parseInt(inDays[1], 10));
    return d.toISOString().slice(0, 10);
  }
  // "next Monday/Tuesday/..."
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const nextDay = lower.match(/^next\s+(\w+)$/);
  if (nextDay) {
    const target = dayNames.indexOf(nextDay[1]);
    if (target !== -1) {
      const d = new Date(today);
      const diff = (target - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d.toISOString().slice(0, 10);
    }
  }
  // Already a YYYY-MM-DD or parseable date
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
};

const normalizeContactNumberTo10Digits = (value) => {
  // NEW
  const digits = value ? String(value).replace(/\D/g, "") : ""; // NEW
  return digits.length > 10 ? digits.slice(-10) : digits; // NEW
}; // NEW

const splitPhoneNumber = (value, fallbackCountryCode = "+91") => {
  const digits = value ? String(value).replace(/\D/g, "") : "";
  let contactNumber = digits;
  let countryCode = fallbackCountryCode || "+91";

  if (digits.length > 10) {
    const inferredCountryCode = digits.slice(0, -10);
    contactNumber = digits.slice(-10);
    if (inferredCountryCode) {
      countryCode = `+${inferredCountryCode}`;
    }
  }

  if (countryCode && !countryCode.startsWith("+")) {
    countryCode = `+${String(countryCode).replace(/\D/g, "")}`;
  }

  return { contactNumber, countryCode };
};

const getOwnedAppointmentForContact = async (
  tenantId,
  contactId,
  appointmentId,
) => {
  if (!appointmentId) return null;

  return db.Appointments.findOne({
    where: {
      tenant_id: tenantId,
      contact_id: contactId,
      appointment_id: appointmentId,
      is_deleted: false,
    },
    include: [
      {
        model: db.Doctors,
        as: "doctor",
        attributes: ["doctor_id", "name", "title", "status"],
      },
    ],
  });
};

// ─── 4A. getOrCreateSession ───────────────────────────────────────────────────
// Returns { session, wasExpired } so callers can inform the user their session expired.
export const getOrCreateSession = async (
  contactId,
  tenantId,
  flowType = "book",
) => {
  const now = new Date();

  // Bulk-expire ALL stale active sessions for this contact+tenant before looking for a live one
  await db.sequelize.query(
    `UPDATE booking_sessions SET status = 'expired', updated_at = NOW()
     WHERE contact_id = ? AND tenant_id = ? AND status = 'active' AND expires_at < NOW()`,
    { replacements: [contactId, tenantId] },
  );

  // Find a still-valid active session (guaranteed non-expired after bulk update above)
  const existing = await db.BookingSessions.findOne({
    where: {
      contact_id: contactId,
      tenant_id: tenantId,
      status: "active",
    },
    order: [["updatedAt", "DESC"]],
  });

  if (existing) {
    // Valid session — refresh TTL
    await existing.update({
      expires_at: new Date(now.getTime() + SESSION_TTL_MS),
      updatedAt: now,
    });
    return { session: existing, wasExpired: false };
  }

  // No live session found — create a fresh one
  let readableSessionId = null;
  try {
    const [rows] = await db.sequelize.query(
      `SELECT session_id
       FROM booking_sessions
       WHERE tenant_id = ? AND session_id LIKE 'SS%'
       ORDER BY session_id DESC
       LIMIT 1`,
      { replacements: [tenantId] },
    );

    const lastId = rows?.[0]?.session_id ? String(rows[0].session_id) : null;
    const lastNum = lastId ? parseInt(lastId.replace(/^SS/i, ""), 10) : 0;
    const nextNum =
      Number.isFinite(lastNum) && !isNaN(lastNum) ? lastNum + 1 : 1;
    readableSessionId = `SS${String(nextNum).padStart(3, "0")}`;
  } catch {
    readableSessionId = null;
  }

  const newSession = await db.BookingSessions.create({
    session_id: readableSessionId || randomUUID(),
    tenant_id: tenantId,
    contact_id: contactId,
    flow_type: flowType,
    current_step: "collecting_doctor",
    status: "active",
    expires_at: new Date(now.getTime() + SESSION_TTL_MS),
  });

  return { session: newSession, wasExpired: true };
};

// ─── 4B. extractAppointmentEntities ──────────────────────────────────────────
export const extractAppointmentEntities = async (message, tenantId) => {
  const today = new Date().toISOString().slice(0, 10);

  const result = await callAI({
    messages: [
      {
        role: "system",
        content: `You are an appointment information extractor.
Today's date is ${today}.

Extract appointment-related information from the user message.
Return ONLY valid JSON with these fields (omit fields not mentioned):
{
  "doctor_name": "string or null",
  "specialization": "string or null",
  "appointment_date": "YYYY-MM-DD or null",
  "appointment_time": "HH:MM AM/PM or null",
  "patient_age": "number or null",
  "reason": "string or null"
}

Date parsing rules:
- "today" = ${today}
- "tomorrow" = add 1 day to today
- "next Monday/Tuesday/..." = find the next occurrence
- "in N days" = add N days to today

Return ONLY the JSON object, no explanation.`,
      },
      { role: "user", content: message },
    ],
    tenant_id: tenantId,
    source: "utility",
    temperature: 0,
    responseFormat: { type: "json_object" },
  });

  let extracted = {};
  try {
    extracted = JSON.parse(result.content);
  } catch {
    return {};
  }

  // Clean nulls
  Object.keys(extracted).forEach((k) => {
    if (extracted[k] === null || extracted[k] === undefined)
      delete extracted[k];
  });

  // Resolve relative dates to absolute YYYY-MM-DD
  if (extracted.appointment_date) {
    const resolved = resolveAbsoluteDate(extracted.appointment_date);
    if (resolved) extracted.appointment_date = resolved;
  }

  // Fuzzy-match doctor by name or specialization
  if (extracted.doctor_name || extracted.specialization) {
    try {
      const searchTerm = extracted.doctor_name || extracted.specialization;
      const doctor = await findDoctorByNameService(tenantId, searchTerm);
      if (doctor) {
        extracted.doctor_id = doctor.doctor_id;
        extracted.doctor_name = doctor.name;
      } else if (extracted.specialization) {
        // Try searching by specialization via getDoctorListService
        const doctors = await getDoctorListService(tenantId);
        const match = doctors.find((d) =>
          (d.specializations || []).some((s) =>
            s.name
              ?.toLowerCase()
              .includes(extracted.specialization.toLowerCase()),
          ),
        );
        if (match) {
          extracted.doctor_id = match.doctor_id;
          extracted.doctor_name = match.name;
        }
      }
    } catch (err) {
      console.error("[APPT-CONV] Doctor lookup failed:", err.message);
    }
  }

  return extracted;
};

// ─── 4C. getMissingFields ─────────────────────────────────────────────────────
export const getMissingFields = (session) => {
  const required = ["doctor_id", "date", "time", "age", "reason"];
  return required.filter((f) => !session[f]);
};

const getMissingFieldPrompt = (missingFields, session) => {
  const firstMissingField = missingFields[0];

  switch (firstMissingField) {
    case "doctor_id":
      return "Please choose a doctor to continue your appointment booking.";
    case "date":
      return session.doctor_name
        ? `What date would you like to book with Dr. ${session.doctor_name}?`
        : "What date would you like to book your appointment for?";
    case "time":
      return "What time would you prefer for the appointment?";
    case "age":
      return "Please share the patient's age.";
    case "reason":
      return "Please tell me the reason for the appointment.";
    default:
      return "Please share the next required appointment detail.";
  }
};

// ─── 4E. handleCreateFlow ─────────────────────────────────────────────────────
export const handleCreateFlow = async (
  session,
  message,
  contact,
  tenantId,
  wasExpired = false,
) => {
  const expiredPrefix = wasExpired
    ? "Your previous booking session expired. Let's start fresh! 🔄\n\n"
    : "";

  // ── Special case: doctor button tap ("doctor_DOC001") — look up by ID directly ──
  if (String(message).startsWith("doctor_")) {
    const doctorId = message.slice("doctor_".length);
    try {
      const doctors = await getDoctorListService(tenantId);
      const matched = doctors.find((d) => d.doctor_id === doctorId);
      if (matched) {
        await session.update({
          doctor_id: matched.doctor_id,
          doctor_name: matched.name,
          current_step: "collecting_date",
          expires_at: new Date(Date.now() + SESSION_TTL_MS),
        });

        const today = new Date().toISOString().slice(0, 10);
        const slotsResult = await getAvailableSlotsService(
          tenantId,
          matched.doctor_id,
          today,
        );
        const freeSlots = slotsResult?.slots || [];

        if (freeSlots.length > 0) {
          await session.update({
            current_step: "collecting_time",
            date: today,
          });
          return {
            success: true,
            message:
              expiredPrefix +
              `Here are the available slots for Dr. ${matched.name} today:`,
            buttonType: "slot_selection",
            slots: freeSlots.slice(0, 3).map((t) => ({ time: t })),
          };
        }

        await session.update({ current_step: "collecting_date" });
        return {
          success: true,
          message:
            expiredPrefix +
            `Dr. ${matched.name} has no available slots today. Please tell me which date you'd prefer.`,
          buttonType: null,
        };
      }
    } catch (err) {
      console.error("[CREATE-FLOW] Doctor button lookup failed:", err.message);
    }
    // Doctor ID not found — show the list so user can pick a valid one
    return await handleListDoctors(tenantId);
  }

  // ── Special case: slot time already decoded ("09:00 AM") — skip AI extraction ──
  const isDecodedSlot = /^\d{2}:\d{2}\s[AP]M$/.test(String(message).trim());
  if (isDecodedSlot) {
    await session.update({
      time: message.trim(),
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    });
    await session.reload();
    const missingAfterSlot = getMissingFields(session);
    if (missingAfterSlot.length > 0) {
      await session.update({
        current_step: `collecting_${missingAfterSlot[0]}`,
      });
    }
    const missing = missingAfterSlot;
    if (missing.length === 0) {
      // All info collected after slot selection — show confirmation
      const available = await checkAvailabilityService(
        tenantId,
        session.doctor_id,
        session.date,
        session.time,
      );
      if (!available) return handleSlotUnavailable(session, tenantId);
      await session.update({
        current_step: "confirming",
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      });
      return {
        success: true,
        message: formatConfirmationMessage(session, contact),
        buttonType: "confirmation",
      };
    }
    return {
      success: true,
      message: getMissingFieldPrompt(missing, session),
      buttonType: null,
    };
  }

  // Step 1 — extract entities from message
  const extracted = await extractAppointmentEntities(message, tenantId);

  // Step 2 — merge into session fields
  const updates = {};
  if (extracted.doctor_id) updates.doctor_id = extracted.doctor_id;
  if (extracted.doctor_name) updates.doctor_name = extracted.doctor_name;
  if (extracted.appointment_date) updates.date = extracted.appointment_date;
  if (extracted.appointment_time) updates.time = extracted.appointment_time;
  if (extracted.patient_age) updates.age = extracted.patient_age;
  if (extracted.reason) updates.reason = extracted.reason;

  // Patient name / contact number from the contact record
  if (!session.patient_name && contact?.name)
    updates.patient_name = contact.name;

  // Refresh TTL on every update
  updates.expires_at = new Date(Date.now() + SESSION_TTL_MS);
  updates.flow_type = "book";

  if (Object.keys(updates).length > 0) {
    await session.update(updates);
    await session.reload();
  }

  // Step 3 — check what is still missing
  const missing = getMissingFields(session);

  // Step 4a — still missing fields → ask for next one
  if (missing.length > 0) {
    // If doctor is missing and we got no match, show doctor list
    if (missing.includes("doctor_id")) {
      const listResult = await handleListDoctors(tenantId);
      if (expiredPrefix)
        listResult.message = expiredPrefix + listResult.message;
      return listResult;
    }

    await session.update({
      current_step: `collecting_${missing[0]}`,
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    });
    return {
      success: true,
      message: expiredPrefix + getMissingFieldPrompt(missing, session),
      buttonType: null,
    };
  }

  // Step 4b — all fields collected → check availability
  const available = await checkAvailabilityService(
    tenantId,
    session.doctor_id,
    session.date,
    session.time,
  );

  if (!available) {
    return await handleSlotUnavailable(session, tenantId);
  }

  // Slot is free → show confirmation
  await session.update({
    current_step: "confirming",
    expires_at: new Date(Date.now() + SESSION_TTL_MS),
  });

  return {
    success: true,
    message: formatConfirmationMessage(session, contact),
    buttonType: "confirmation",
  };
};

// ─── 4F. handleViewFlow ───────────────────────────────────────────────────────
export const handleViewFlow = async (contact, tenantId) => {
  const appointments = await getActiveAppointmentsByContactService(
    tenantId,
    contact.contact_id,
  );

  if (!appointments || appointments.length === 0) {
    return {
      success: true,
      message:
        "You have no upcoming appointments.\n\nWould you like to book one?",
      buttonType: "book_prompt",
    };
  }

  const lines = appointments.map((a, i) => {
    const doc = a.doctor?.name || "No doctor assigned";
    const spec = a.doctor?.title || "";
    const dateStr = formatDateLong(a.appointment_date);
    return (
      `*${i + 1}. Dr. ${doc}*${spec ? ` (${spec})` : ""}\n` +
      `   Date: ${dateStr}\n` +
      `   Time: ${a.appointment_time}\n` +
      `   Token: #${a.token_number || "—"}\n` +
      `   Status: ${a.status}`
    );
  });

  return {
    success: true,
    appointments,
    message: `*Your Upcoming Appointments*\n\n${lines.join("\n\n")}`,
    buttonType: "appointment_actions",
  };
};

// ─── 4G. handleCancelFlow ─────────────────────────────────────────────────────
export const handleCancelFlow = async (
  session,
  message,
  contact,
  tenantId,
  wasExpired = false,
) => {
  // If message is a button ID like "cancel_AP001", target that appointment directly
  const directCancelId = String(message).startsWith("cancel_")
    ? message.slice("cancel_".length)
    : null;

  const appointments = await getActiveAppointmentsByContactService(
    tenantId,
    contact.contact_id,
  );

  if (!appointments || appointments.length === 0) {
    return {
      success: true,
      message: "You have no active appointments to cancel.",
      buttonType: null,
    };
  }

  let targetAppointment = null;

  // Direct target from button ID takes priority
  if (directCancelId) {
    targetAppointment =
      appointments.find((a) => a.appointment_id === directCancelId) || null;
  }

  if (!targetAppointment && appointments.length === 1) {
    targetAppointment = appointments[0];
  } else if (!targetAppointment) {
    // Use AI to identify which appointment the user is referring to
    const apptContext = appointments.map((a, i) => ({
      index: i + 1,
      appointment_id: a.appointment_id,
      doctor: a.doctor?.name,
      date: a.appointment_date,
      time: a.appointment_time,
    }));

    const matchResult = await callAI({
      messages: [
        {
          role: "system",
          content: `The user wants to cancel an appointment.
Available appointments: ${JSON.stringify(apptContext)}
User message: "${message}"
Return JSON: { "matched_index": number or null, "confidence": 0.0-1.0 }
matched_index is the 1-based index from the list, or null if unclear.`,
        },
      ],
      tenant_id: tenantId,
      source: "utility",
      temperature: 0,
      responseFormat: { type: "json_object" },
    });

    try {
      const match = JSON.parse(matchResult.content);
      if (match.confidence >= 0.8 && match.matched_index) {
        targetAppointment = appointments[match.matched_index - 1];
      }
    } catch {
      /* no match */
    }

    if (!targetAppointment) {
      // Show numbered list and ask user to pick
      const lines = appointments.map(
        (a, i) =>
          `${i + 1}. Dr. ${a.doctor?.name || "—"} — ${formatDateLong(a.appointment_date)} at ${a.appointment_time}`,
      );
      return {
        success: true,
        message: `Which appointment would you like to cancel?\n\n${lines.join("\n")}`,
        buttonType: null,
      };
    }
  }

  // Store target in session and show confirmation
  await session.update({
    appointment_id: targetAppointment.appointment_id,
    flow_type: "cancel",
    current_step: "confirming",
    expires_at: new Date(Date.now() + SESSION_TTL_MS),
  });

  const dateStr = formatDateLong(targetAppointment.appointment_date);
  return {
    success: true,
    message:
      `Are you sure you want to cancel your appointment?\n\n` +
      `*Doctor:* Dr. ${targetAppointment.doctor?.name || "—"}\n` +
      `*Date:* ${dateStr}\n` +
      `*Time:* ${targetAppointment.appointment_time}`,
    buttonType: "cancel_confirmation",
  };
};

// ─── 4H. handleSlotUnavailable ────────────────────────────────────────────────
export const handleSlotUnavailable = async (session, tenantId) => {
  try {
    const slotsResult = await getAvailableSlotsService(
      tenantId,
      session.doctor_id,
      session.date,
    );

    const freeSlots = slotsResult?.slots || [];

    if (freeSlots.length === 0) {
      await session.update({
        date: null,
        time: null,
        current_step: "collecting_date",
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      });
      return {
        success: true,
        message:
          "No slots available on that date. What other date would you like to try?",
        buttonType: null,
      };
    }

    await session.update({
      time: null,
      current_step: "collecting_time",
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    });

    const nextThree = freeSlots.slice(0, 3).map((t) => ({ time: t }));
    return {
      success: true,
      message: "That slot is taken. Here are the next available times:",
      buttonType: "slot_selection",
      slots: nextThree,
    };
  } catch (err) {
    console.error("[APPT-CONV] handleSlotUnavailable error:", err.message);
    return {
      success: true,
      message: "That slot is unavailable. Please try a different time.",
      buttonType: null,
    };
  }
};

// ─── 4I. handleRescheduleFlow ─────────────────────────────────────────────────
export const handleRescheduleFlow = async (
  session,
  message,
  contact,
  tenantId,
  wasExpired = false,
) => {
  // If message is a button ID like "reschedule_AP001", target that appointment directly
  const directRescheduleId = String(message).startsWith("reschedule_")
    ? message.slice("reschedule_".length)
    : null;

  const appointments = await getActiveAppointmentsByContactService(
    tenantId,
    contact.contact_id,
  );

  if (!appointments || appointments.length === 0) {
    return {
      success: true,
      message: "You have no active appointments to reschedule.",
      buttonType: null,
    };
  }

  let targetAppointment = null;

  // Direct target from button ID takes priority
  if (directRescheduleId) {
    targetAppointment =
      appointments.find((a) => a.appointment_id === directRescheduleId) || null;
  }

  if (!targetAppointment && appointments.length === 1) {
    targetAppointment = appointments[0];
  } else if (!targetAppointment) {
    const apptContext = appointments.map((a, i) => ({
      index: i + 1,
      appointment_id: a.appointment_id,
      doctor: a.doctor?.name,
      date: a.appointment_date,
      time: a.appointment_time,
    }));

    const matchResult = await callAI({
      messages: [
        {
          role: "system",
          content: `The user wants to reschedule an appointment.
Available appointments: ${JSON.stringify(apptContext)}
User message: "${message}"
Return JSON: { "matched_index": number or null, "confidence": 0.0-1.0 }`,
        },
      ],
      tenant_id: tenantId,
      source: "utility",
      temperature: 0,
      responseFormat: { type: "json_object" },
    });

    try {
      const match = JSON.parse(matchResult.content);
      if (match.confidence >= 0.8 && match.matched_index) {
        targetAppointment = appointments[match.matched_index - 1];
      }
    } catch {
      /* no match */
    }

    if (!targetAppointment) {
      const lines = appointments.map(
        (a, i) =>
          `${i + 1}. Dr. ${a.doctor?.name || "—"} — ${formatDateLong(a.appointment_date)} at ${a.appointment_time}`,
      );
      return {
        success: true,
        message: `Which appointment would you like to reschedule?\n\n${lines.join("\n")}`,
        buttonType: null,
      };
    }
  }

  // Extract new date/time from the message
  const extracted = await extractAppointmentEntities(message, tenantId);
  const newDate = extracted.appointment_date || null;
  const newTime = extracted.appointment_time || null;
  const requestedDoctorId = extracted.doctor_id || targetAppointment.doctor_id;
  const requestedDoctorName =
    extracted.doctor_name || targetAppointment.doctor?.name;

  if (requestedDoctorId !== targetAppointment.doctor_id) {
    const requestedDoctor = await db.Doctors.findOne({
      where: {
        tenant_id: tenantId,
        doctor_id: requestedDoctorId,
        is_deleted: false,
      },
      attributes: ["doctor_id", "name", "status"],
    });

    if (!requestedDoctor) {
      const listResult = await handleListDoctors(tenantId);
      if (listResult?.success) {
        listResult.message =
          "I could not find that doctor. Please choose a doctor from the list.";
      }
      return listResult;
    }

    if (requestedDoctor.status !== "available") {
      return {
        success: true,
        message: `Dr. ${requestedDoctor.name} is currently unavailable. Please choose another doctor or time.`,
        buttonType: null,
      };
    }
  }

  if (!newDate || !newTime) {
    // Store the target and ask for new time
    await session.update({
      appointment_id: targetAppointment.appointment_id,
      doctor_id: requestedDoctorId,
      doctor_name: requestedDoctorName,
      flow_type: "edit",
      current_step: "collecting_date",
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    });
    return {
      success: true,
      message: `Sure, I can reschedule your appointment with Dr. ${targetAppointment.doctor?.name || "your doctor"}.\n\nWhat new date and time would you prefer?`,
      buttonType: null,
    };
  }

  // Check availability for the new slot
  const available = await checkAvailabilityService(
    tenantId,
    requestedDoctorId,
    newDate,
    newTime,
    targetAppointment.appointment_id,
  );

  if (!available) {
    await session.update({
      appointment_id: targetAppointment.appointment_id,
      doctor_id: requestedDoctorId,
      doctor_name: requestedDoctorName,
      date: newDate,
      flow_type: "edit",
      current_step: "collecting_time",
      expires_at: new Date(Date.now() + SESSION_TTL_MS),
    });
    await session.reload();
    return handleSlotUnavailable(session, tenantId);
  }

  // Store new time and show old vs new confirmation
  await session.update({
    appointment_id: targetAppointment.appointment_id,
    doctor_id: requestedDoctorId,
    doctor_name: requestedDoctorName,
    date: newDate,
    time: newTime,
    flow_type: "edit",
    current_step: "confirming",
    expires_at: new Date(Date.now() + SESSION_TTL_MS),
  });

  const oldDate = formatDateLong(targetAppointment.appointment_date);
  const newDateStr = formatDateLong(newDate);
  return {
    success: true,
    message:
      `*Reschedule Confirmation*\n\n` +
      `*Doctor:* Dr. ${requestedDoctorName || "—"}\n` +
      `*From:* ${oldDate} at ${targetAppointment.appointment_time}\n` +
      `*To:* ${newDateStr} at ${newTime}\n\n` +
      `Confirm the change?`,
    buttonType: "confirmation",
  };
};

// ─── 4J. handleConfirmation ───────────────────────────────────────────────────
export const handleConfirmation = async (
  messageOrButtonId,
  contact,
  tenantId,
) => {
  // Find any active session in confirming state for this contact+tenant
  const session = await db.BookingSessions.findOne({
    where: {
      contact_id: contact.contact_id,
      tenant_id: tenantId,
      status: "active",
      current_step: "confirming",
    },
    order: [["updatedAt", "DESC"]],
  });

  if (!session) return null; // Not in a confirmation flow

  // Detect YES / NO from button id or plain text
  const raw = String(messageOrButtonId || "")
    .toLowerCase()
    .trim();

  const isYes =
    raw === "confirm_yes" ||
    /^(yes|y|confirm|ok|sure|book|proceed|हाँ|हां|ha|haan)/.test(raw);

  const isNo =
    raw === "confirm_no" ||
    /^(no|n|cancel|nahi|नहीं|nope|stop|don't)/.test(raw);

  if (!isYes && !isNo) {
    return {
      success: true,
      message: "Please confirm — should I go ahead?",
      buttonType: "confirmation",
    };
  }

  if (isNo) {
    await session.update({ status: "cancelled" });
    return {
      success: true,
      message:
        "No problem, I've cancelled that. Let me know if you need anything else.",
      buttonType: null,
    };
  }

  // ── YES — execute the action ───────────────────────────────────────────────
  await session.update({ current_step: "processing" });

  try {
    if (session.flow_type === "cancel" && session.appointment_id) {
      const ownedAppointment = await getOwnedAppointmentForContact(
        tenantId,
        contact.contact_id,
        session.appointment_id,
      );

      if (!ownedAppointment) {
        throw new Error("Appointment not found for this contact.");
      }

      await deleteAppointmentService(tenantId, session.appointment_id);
      try {
        // NEW
        const io = getIO(); // NEW
        io.to(`tenant-${tenantId}`).emit("appointment:cancelled", {
          // NEW
          appointment_id: session.appointment_id, // NEW
        }); // NEW
      } catch {} // NEW
      await session.update({ status: "completed" });
      return {
        success: true,
        message: "✅ Your appointment has been *cancelled* successfully.",
        buttonType: null,
      };
    }

    if (session.flow_type === "edit" && session.appointment_id) {
      const ownedAppointment = await getOwnedAppointmentForContact(
        tenantId,
        contact.contact_id,
        session.appointment_id,
      );

      if (!ownedAppointment) {
        throw new Error("Appointment not found for this contact.");
      }

      await updateAppointmentService(tenantId, session.appointment_id, {
        appointment_date: session.date,
        appointment_time: session.time,
        doctor_id: session.doctor_id || ownedAppointment.doctor_id,
      });
      try {
        // NEW
        const io = getIO(); // NEW
        io.to(`tenant-${tenantId}`).emit("appointment:updated", {
          // NEW
          appointment_id: session.appointment_id, // NEW
          appointment_date: session.date, // NEW
          appointment_time: session.time, // NEW
          doctor_id: session.doctor_id || ownedAppointment.doctor_id, // NEW
        }); // NEW
      } catch {} // NEW
      await session.update({ status: "completed" });
      return {
        success: true,
        message:
          `✅ Your appointment has been *rescheduled*.\n\n` +
          `*Doctor:* Dr. ${session.doctor_name || ownedAppointment.doctor?.name || "—"}\n` +
          `*New Date:* ${formatDateLong(session.date)}\n` +
          `*New Time:* ${session.time}`,
        buttonType: null,
      };
    }

    // New booking
    const contactRecord = contact;
    const phone = String(
      contactRecord.phone || contactRecord.phone_number || "",
    );
    const { contactNumber, countryCode } = splitPhoneNumber(
      phone,
      contactRecord.country_code || "+91",
    );

    const created = await createAppointmentService({
      tenant_id: tenantId,
      doctor_id: session.doctor_id || null,
      patient_name: session.patient_name || contactRecord.name,
      contact_number: contactNumber,
      country_code: countryCode,
      appointment_date: session.date,
      appointment_time: session.time,
      age: session.age || null,
      notes: session.reason || null,
      contact_id: contactRecord.contact_id,
      email: session.email || null,
    });

    try {
      // NEW
      const io = getIO(); // NEW
      io.to(`tenant-${tenantId}`).emit("appointment:created", {
        // NEW
        appointment_id: created.appointment_id, // NEW
        patient_name: created.patient_name, // NEW
        doctor_name: session.doctor_name || null, // NEW
        appointment_date: created.appointment_date || session.date, // NEW
        appointment_time: created.appointment_time || session.time, // NEW
        token_number: created.token_number, // NEW
      }); // NEW
    } catch {} // NEW

    await session.update({ status: "completed" });

    return {
      success: true,
      message:
        `✅ *Appointment Confirmed!*\n\n` +
        `*Patient:* ${session.patient_name || contactRecord.name}\n` +
        `*Doctor:* Dr. ${session.doctor_name || "—"}\n` +
        `*Date:* ${formatDateLong(session.date)}\n` +
        `*Time:* ${session.time}\n` +
        `*Token:* #${created.token_number}\n\n` +
        `See you soon! 🏥`,
      buttonType: "post_booking",
      tokenNumber: created.token_number,
    };
  } catch (err) {
    console.error(
      "[APPT-CONV] handleConfirmation execution error:",
      err.message,
    );
    await session.update({ current_step: "confirming" });
    return {
      success: false,
      message: `Sorry, there was an issue: ${err.message}\n\nPlease try again.`,
      buttonType: null,
    };
  }
};

// ─── 4K. handleAppointmentIntent ─────────────────────────────────────────────
export const handleAppointmentIntent = async (
  intent,
  message,
  contact,
  tenantId,
) => {
  // Voice / non-text guard
  if (!message || typeof message !== "string") {
    return {
      success: false,
      message:
        "Sorry, I can only handle text messages for appointments. Please type your request.",
      buttonType: null,
    };
  }

  switch (intent) {
    case "create_appointment":
    case "APPOINTMENT_ACTION": {
      const { session, wasExpired } = await getOrCreateSession(
        contact.contact_id,
        tenantId,
        "book",
      );
      return handleCreateFlow(session, message, contact, tenantId, wasExpired);
    }

    case "view_my_appointments":
      return handleViewFlow(contact, tenantId);

    case "reschedule_appointment": {
      const { session, wasExpired } = await getOrCreateSession(
        contact.contact_id,
        tenantId,
        "edit",
      );
      return handleRescheduleFlow(
        session,
        message,
        contact,
        tenantId,
        wasExpired,
      );
    }

    case "cancel_appointment": {
      const { session, wasExpired } = await getOrCreateSession(
        contact.contact_id,
        tenantId,
        "cancel",
      );
      return handleCancelFlow(session, message, contact, tenantId, wasExpired);
    }

    case "check_doctor_availability": {
      const extracted = await extractAppointmentEntities(message, tenantId);
      if (!extracted.doctor_id || !extracted.appointment_date) {
        return {
          success: true,
          message:
            "Which doctor and date would you like to check availability for?",
          buttonType: null,
        };
      }
      const slotsResult = await getAvailableSlotsService(
        tenantId,
        extracted.doctor_id,
        extracted.appointment_date,
      );
      if (!slotsResult?.slots?.length) {
        return {
          success: true,
          message: `Dr. ${extracted.doctor_name} has no available slots on ${formatDateLong(extracted.appointment_date)}.`,
          buttonType: null,
        };
      }
      const slotList = slotsResult.slots.slice(0, 10).join(", ");
      return {
        success: true,
        message:
          `*Available slots for Dr. ${extracted.doctor_name}*\n` +
          `*Date:* ${formatDateLong(extracted.appointment_date)}\n\n` +
          slotList,
        buttonType: null,
      };
    }

    case "list_available_doctors":
      return handleListDoctors(tenantId);

    case "get_doctor_info": {
      const extracted = await extractAppointmentEntities(message, tenantId);
      if (!extracted.doctor_id) {
        return handleListDoctors(tenantId);
      }
      const doctors = await getDoctorListService(tenantId);
      const doctor = doctors.find((d) => d.doctor_id === extracted.doctor_id);
      if (!doctor) {
        return handleListDoctors(tenantId);
      }
      const specs =
        (doctor.specializations || []).map((s) => s.name).join(", ") ||
        "General";
      const avail =
        (doctor.availability || [])
          .map((a) => `${a.day_of_week}: ${a.start_time}–${a.end_time}`)
          .join(", ") || "Contact clinic";
      return {
        success: true,
        message:
          `*Dr. ${doctor.name}*\n` +
          `Specialization: ${specs}\n` +
          `Experience: ${doctor.experience_years || 0} years\n` +
          `Qualification: ${doctor.qualification || "—"}\n` +
          `Availability: ${avail}`,
        buttonType: null,
      };
    }

    default:
      return {
        success: true,
        message: "How can I help you with your appointment today?",
        buttonType: "book_prompt",
      };
  }
};

// ─── Helper: list doctors as a list button ────────────────────────────────────
const handleListDoctors = async (tenantId) => {
  try {
    const doctors = await getDoctorListService(tenantId);
    if (!doctors || doctors.length === 0) {
      return {
        success: true,
        message:
          "No doctors are currently available. Please contact us directly.",
        buttonType: null,
      };
    }
    const formatted = doctors.map((d) => ({
      id: d.doctor_id,
      name: d.name,
      specialization:
        (d.specializations || []).map((s) => s.name).join(", ") || "General",
    }));
    return {
      success: true,
      message: "I couldn't find that doctor. Here are our available doctors:",
      buttonType: "doctor_list",
      doctors: formatted,
    };
  } catch (err) {
    console.error("[APPT-CONV] handleListDoctors error:", err.message);
    return {
      success: true,
      message: "Please contact us to get the list of available doctors.",
      buttonType: null,
    };
  }
};

// ─── 4L. formatConfirmationMessage ────────────────────────────────────────────
export const formatConfirmationMessage = (session, contact) => {
  const patientName = session.patient_name || contact?.name || "—";
  const contactNumber = contact?.phone || contact?.phone_number || "—";
  const dateStr = formatDateLong(session.date);

  return (
    `*Appointment Summary*\n\n` +
    `*Patient:* ${patientName}\n` +
    `*Contact:* ${contactNumber}\n` +
    `*Doctor:* Dr. ${session.doctor_name || "—"}\n` +
    `*Date:* ${dateStr}\n` +
    `*Time:* ${session.time || "—"}\n` +
    `*Age:* ${session.age || "—"}\n` +
    `*Reason:* ${session.reason || "Not specified"}\n\n` +
    `Please confirm your booking.`
  );
};

// ─── 4M. cleanupExpiredSessions ───────────────────────────────────────────────
export const cleanupExpiredSessions = async () => {
  try {
    const [, meta] = await db.sequelize.query(
      `UPDATE booking_sessions
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active'
         AND expires_at < NOW()`,
    );
    const count = meta?.affectedRows ?? 0;
    if (count > 0) {
      console.log(
        `[SESSION-CLEANUP] Expired ${count} stale booking session(s)`,
      );
    }
  } catch (err) {
    console.error("[SESSION-CLEANUP] Error:", err.message);
  }
};

// Default export — orchestrator object for clean imports in the message handler
export const appointmentOrchestrator = {
  getOrCreateSession,
  handleAppointmentIntent,
  handleConfirmation,
  cleanupExpiredSessions,
};
