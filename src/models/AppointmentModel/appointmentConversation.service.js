import { randomUUID } from "crypto";
import db from "../../database/index.js";
import {
  createAppointmentService,
  checkAvailabilityService,
  getAvailableSlotsService,
  updateAppointmentService,
  deleteAppointmentService,
  getActiveAppointmentsByContactService,
} from "./appointment.service.js";
import { getDoctorListService } from "../DoctorModel/doctor.service.js";
import { getIO } from "../../middlewares/socket/socket.js";
import {
  buildSlotSelectionContext,
  getSlotSelectionRows,
  resolveSlotSelection,
} from "./appointmentSlotGrouping.service.js";

export {
  buildSlotSelectionContext,
  getSlotSelectionRows,
  normalizeAppointmentSlots,
  resolveSlotSelection,
} from "./appointmentSlotGrouping.service.js";

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ─── Named step constants ────────────────────────────────────────────────────
export const STEPS = {
  COLLECT_NAME:     "COLLECT_NAME",
  COLLECT_EMAIL:    "COLLECT_EMAIL",
  SELECT_DOCTOR:    "SELECT_DOCTOR",
  SELECT_DATE:      "SELECT_DATE",
  SELECT_TIME:      "SELECT_TIME",
  COLLECT_REASON:   "COLLECT_REASON",
  CONFIRM_BOOKING:  "CONFIRM_BOOKING",
  EDIT_MENU:        "EDIT_MENU",
  EDIT_FIELD:       "EDIT_FIELD",
  BOOKING_COMPLETE: "BOOKING_COMPLETE",
};

// Maps edit button IDs → the state they re-enter
const EDIT_TARGET_TO_STEP = {
  edit_name:   STEPS.COLLECT_NAME,
  edit_email:  STEPS.COLLECT_EMAIL,
  edit_doctor: STEPS.SELECT_DOCTOR,
  edit_date:   STEPS.SELECT_DATE,
  edit_time:   STEPS.SELECT_TIME,
  edit_reason: STEPS.COLLECT_REASON,
};

// Words that cancel the active booking session immediately
const QUIT_TRIGGERS = new Set([
  "quit",
  "exit",
  "stop",
  "cancel",
  "leave",
  "no need",
  "not now",
  "cancel appointment",
  "stop booking",
  "end booking",
  "nevermind",
  "never mind",
  "abort",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

const splitPhoneNumber = (value, fallbackCountryCode = "+91") => {
  const digits = value ? String(value).replace(/\D/g, "") : "";
  let contactNumber = digits;
  let countryCode = fallbackCountryCode || "+91";
  if (digits.length > 10) {
    const inferredCountryCode = digits.slice(0, -10);
    contactNumber = digits.slice(-10);
    if (inferredCountryCode) countryCode = `+${inferredCountryCode}`;
  }
  if (countryCode && !countryCode.startsWith("+")) {
    countryCode = `+${String(countryCode).replace(/\D/g, "")}`;
  }
  return { contactNumber, countryCode };
};

const readSessionDraft = (session) => {
  const draft = session?.draft_json;
  if (!draft) return {};
  if (typeof draft === "string") {
    try {
      return JSON.parse(draft) || {};
    } catch {
      return {};
    }
  }
  return typeof draft === "object" ? { ...draft } : {};
};

const clearSlotSelectionDraft = (session) => {
  const draft = readSessionDraft(session);
  delete draft.slotSelection;
  return draft;
};

const getOwnedAppointmentForContact = async (tenantId, contactId, appointmentId) => {
  if (!appointmentId) return null;
  return db.Appointments.findOne({
    where: {
      tenant_id: tenantId,
      contact_id: contactId,
      appointment_id: appointmentId,
      is_deleted: false,
    },
    include: [{
      model: db.Doctors,
      as: "doctor",
      attributes: ["doctor_id", "name", "title", "status"],
    }],
  });
};

// Generate 7 date buttons: today+1 … today+7, always fresh (never same-day)
const generateDateButtons = () => {
  const today = new Date();
  const buttons = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    buttons.push({ id: `date_${iso}`, label });
  }
  return buttons;
};

// ─── getOrCreateSession ───────────────────────────────────────────────────────
export const getOrCreateSession = async (contactId, tenantId, flowType = "book") => {
  const now = new Date();

  // Bulk-expire stale active sessions for this contact+tenant
  await db.sequelize.query(
    `UPDATE booking_sessions SET status = 'expired', updated_at = NOW()
     WHERE contact_id = ? AND tenant_id = ? AND status = 'active' AND expires_at < NOW()`,
    { replacements: [contactId, tenantId] },
  );

  const existing = await db.BookingSessions.findOne({
    where: { contact_id: contactId, tenant_id: tenantId, status: "active" },
    order: [["updatedAt", "DESC"]],
  });

  if (existing) {
    await existing.update({
      expires_at: new Date(now.getTime() + SESSION_TTL_MS),
      updatedAt: now,
    });
    return { session: existing, wasExpired: false };
  }

  // Generate readable session ID (SS001, SS002, …)
  let readableSessionId = null;
  try {
    const [rows] = await db.sequelize.query(
      `SELECT session_id FROM booking_sessions
       WHERE session_id LIKE 'SS%'
       ORDER BY session_id DESC LIMIT 1`,
    );
    const lastId = rows?.[0]?.session_id ? String(rows[0].session_id) : null;
    const lastNum = lastId ? parseInt(lastId.replace(/^SS/i, ""), 10) : 0;
    const nextNum = Number.isFinite(lastNum) && !isNaN(lastNum) ? lastNum + 1 : 1;
    readableSessionId = `SS${String(nextNum).padStart(3, "0")}`;
  } catch {
    readableSessionId = null;
  }

  const newSession = await db.BookingSessions.create({
    session_id: readableSessionId || randomUUID(),
    tenant_id: tenantId,
    contact_id: contactId,
    flow_type: flowType,
    current_step: STEPS.COLLECT_NAME,
    status: "active",
    expires_at: new Date(now.getTime() + SESSION_TTL_MS),
  });

  return { session: newSession, wasExpired: true };
};

// ─── enterState ───────────────────────────────────────────────────────────────
// Called when transitioning INTO a state. Renders the state's prompt / buttons.
// This never processes user input — it only produces the outgoing message.
const enterState = async (session, step, contact, tenantId, note = null) => {
  const prefix = note ? `${note}\n\n` : "";

  await session.update({
    current_step: step,
    expires_at: new Date(Date.now() + SESSION_TTL_MS),
  });

  switch (step) {
    // ── State 1: COLLECT_NAME ──────────────────────────────────────────────
    case STEPS.COLLECT_NAME: {
      const contactName = contact?.name || contact?.contact_name || null;
      // Auto-skip if contact already has a name AND we are NOT re-editing it
      if (contactName && session.edit_target !== "edit_name") {
        await session.update({ patient_name: contactName });
        return enterState(session, STEPS.COLLECT_EMAIL, contact, tenantId, null);
      }
      return {
        success: true,
        message: prefix + "What is the Patient name?",
        buttonType: null,
      };
    }

    // ── State 2: COLLECT_EMAIL ─────────────────────────────────────────────
    case STEPS.COLLECT_EMAIL:
      return {
        success: true,
        message: prefix + "Share your email for confirmation.",
        buttonType: null,
      };

    // ── State 3: SELECT_DOCTOR ─────────────────────────────────────────────
    case STEPS.SELECT_DOCTOR: {
      const allDoctors = await getDoctorListService(tenantId);
      const available = (allDoctors || []).filter(
        (d) => !d.status || d.status === "available",
      );
      if (!available.length) {
        await session.update({
          status: "cancelled",
          draft_json: clearSlotSelectionDraft(session),
        });
        return {
          success: true,
          message: "It seems No Doctors available Today - Try again Later.",
          buttonType: null,
        };
      }
      const formatted = available.slice(0, 10).map((d) => ({
        id: `doctor_${d.doctor_id}`,
        name: d.name,
        specialization:
          (d.specializations || []).map((s) => s.name).join(", ") || "General",
      }));
      return {
        success: true,
        message:
          prefix +
          `👨‍⚕️ *Choose Your Doctor*\n\nHere are our available specialists today.\nTap *"See Doctors"* below to browse and select:`,
        buttonType: "doctor_list",
        doctors: formatted,
      };
    }

    // ── State 4: SELECT_DATE ───────────────────────────────────────────────
    case STEPS.SELECT_DATE: {
      const dates = generateDateButtons();
      const doctorNote = session.doctor_name
        ? `📅 *Select Appointment Date*\n\nDr. ${session.doctor_name} is available on the following dates.\nTap *"Pick a Date"* below to choose:`
        : `📅 *Select Appointment Date*\n\nChoose a convenient date for your appointment.\nTap *"Pick a Date"* below:`;
      return {
        success: true,
        message: prefix + doctorNote,
        buttonType: "date_selection",
        doctorName: session.doctor_name || null,
        dates,
      };
    }

    // ── State 5: SELECT_TIME ───────────────────────────────────────────────
    case STEPS.SELECT_TIME: {
      const slotsResult = await getAvailableSlotsService(
        tenantId,
        session.doctor_id,
        session.date,
      );
      const freeSlots = slotsResult?.slots || [];

      if (!freeSlots.length) {
        // Bounce back to SELECT_DATE — doctor preserved, date + time cleared
        await session.update({
          date: null,
          time: null,
          draft_json: clearSlotSelectionDraft(session),
        });
        return enterState(
          session,
          STEPS.SELECT_DATE,
          contact,
          tenantId,
          `No slots are available for ${formatDateLong(session.date)}. Please pick another date.`,
        );
      }

      const slotSelection = buildSlotSelectionContext({
        doctorId: session.doctor_id,
        date: session.date,
        slots: freeSlots,
      });
      await session.update({
        draft_json: {
          ...readSessionDraft(session),
          slotSelection,
        },
      });
      const slotRows = getSlotSelectionRows(slotSelection);

      return {
        success: true,
        message: prefix + slotRows.message,
        buttonType: "slot_selection",
        doctorName: session.doctor_name || null,
        dateLabel: formatDateLong(session.date),
        slotSelectionMode: slotRows.mode,
        slotSectionTitle: slotRows.sectionTitle,
        slots: slotRows.rows,
      };
    }

    // ── State 6: COLLECT_REASON ────────────────────────────────────────────
    case STEPS.COLLECT_REASON:
      return {
        success: true,
        message: prefix + "What is the reason for your visit?",
        buttonType: null,
      };

    // ── State 7: CONFIRM_BOOKING ───────────────────────────────────────────
    case STEPS.CONFIRM_BOOKING: {
      await session.reload();
      return {
        success: true,
        // The controller's buildConfirmPayload uses session directly for the
        // rich interactive template.  Plain message is kept as fallback text.
        message: prefix + "Please confirm or edit your appointment booking.",
        buttonType: "confirm_or_edit",
        session,  // pass full session for rich template builder
      };
    }

    // ── State 8: EDIT_MENU ─────────────────────────────────────────────────
    case STEPS.EDIT_MENU:
      return {
        success: true,
        message: prefix + "Which detail would you like to change?",
        buttonType: "edit_menu",
        editOptions: [
          { id: "edit_name",   label: "Name" },
          { id: "edit_email",  label: "Email" },
          { id: "edit_doctor", label: "Doctor" },
          { id: "edit_date",   label: "Date" },
          { id: "edit_time",   label: "Time" },
          { id: "edit_reason", label: "Reason" },
        ],
      };

    // ── State 9: EDIT_FIELD ────────────────────────────────────────────────
    case STEPS.EDIT_FIELD: {
      const target = session.edit_target;
      const targetStep = EDIT_TARGET_TO_STEP[target];
      if (!targetStep) {
        return enterState(session, STEPS.CONFIRM_BOOKING, contact, tenantId, null);
      }
      // Editing date must also clear time (old time may not exist on new date)
      if (target === "edit_date") {
        await session.update({
          time: null,
          draft_json: clearSlotSelectionDraft(session),
        });
      }
      await session.update({ previous_step: STEPS.CONFIRM_BOOKING });
      return enterState(session, targetStep, contact, tenantId, null);
    }

    default:
      return {
        success: true,
        message: "How can I help you with your appointment today?",
        buttonType: "book_prompt",
      };
  }
};

// ─── _executeBooking ──────────────────────────────────────────────────────────
// Final availability re-check + createAppointmentService inside transaction.
// Called from handleConfirmation (button tap) and handleMessage (free-text "yes").
const _executeBooking = async (session, contact, tenantId) => {
  // Race-condition guard: re-verify slot is still free
  const available = await checkAvailabilityService(
    tenantId,
    session.doctor_id,
    session.date,
    session.time,
  );

  if (!available) {
    await session.update({
      time: null,
      draft_json: clearSlotSelectionDraft(session),
    });
    return enterState(
      session,
      STEPS.SELECT_TIME,
      contact,
      tenantId,
      "That slot was just taken by someone else. Please pick another time.",
    );
  }

  const phone = String(contact.phone || contact.phone_number || "");
  const { contactNumber, countryCode } = splitPhoneNumber(
    phone,
    contact.country_code || "+91",
  );

  try {
    const created = await createAppointmentService({
      tenant_id: tenantId,
      doctor_id: session.doctor_id || null,
      patient_name: session.patient_name || contact.name || null,
      contact_number: contactNumber,
      country_code: countryCode,
      appointment_date: session.date,
      appointment_time: session.time,
      age: session.age || null,
      notes: session.reason || null,
      contact_id: contact.contact_id,
      email: session.patient_email || session.email || contact.email || null,
    });

    try {
      const io = getIO();
      io.to(`tenant-${tenantId}`).emit("appointment:created", {
        appointment_id: created.appointment_id,
        patient_name: created.patient_name,
        doctor_name: session.doctor_name || null,
        appointment_date: created.appointment_date || session.date,
        appointment_time: created.appointment_time || session.time,
        token_number: created.token_number,
      });
    } catch { /* socket not critical */ }

    await session.update({
      status: "completed",
      draft_json: clearSlotSelectionDraft(session),
    });

    return {
      success: true,
      message:
        `✅ *Appointment Confirmed!*\n\n` +
        `*Patient:* ${session.patient_name || contact.name || "—"}\n` +
        `*Doctor:* Dr. ${session.doctor_name || "—"}\n` +
        `*Date:* ${formatDateLong(session.date)}\n` +
        `*Time:* ${session.time}\n` +
        `*Token:* #${created.token_number}\n\n` +
        `See you soon! 🏥`,
      buttonType: "post_booking",
      tokenNumber: created.token_number,
    };
  } catch (err) {
    console.error("[APPT-CONV] _executeBooking error:", err.message);
    await session.update({ current_step: STEPS.CONFIRM_BOOKING });
    return {
      success: false,
      message: `Sorry, there was an issue: ${err.message}\n\nPlease try again.`,
      buttonType: "confirm_or_edit",
    };
  }
};

// ─── handleMessage ────────────────────────────────────────────────────────────
// Main entry for new booking flow. Called by handleAppointmentIntent for
// create_appointment / APPOINTMENT_ACTION intents and active-session intercept.
export const handleMessage = async (message, contact, tenantId) => {
  if (!message || typeof message !== "string") {
    return {
      success: false,
      message: "Sorry, I can only handle text messages. Please type your request.",
      buttonType: null,
    };
  }

  const { session, wasExpired } = await getOrCreateSession(
    contact.contact_id,
    tenantId,
    "book",
  );

  const step = session.current_step;
  const msg = message.trim();

  // ── Fresh session: the trigger message is an INTENT, not data input ──────
  // Never consume the booking-intent phrase as a field value.
  // Just enter the first state and wait for the user's real answer.
  if (wasExpired) {
    return enterState(session, STEPS.COLLECT_NAME, contact, tenantId, null);
  }

  // ── QUIT check — runs before any state routing ────────────────────────────
  // If the user types a quit word, cancel the session and end the flow.
  const msgLower = msg.toLowerCase();
  if (QUIT_TRIGGERS.has(msgLower)) {
    await session.update({
      status: "cancelled",
      draft_json: clearSlotSelectionDraft(session),
    });
    return {
      success: true,
      message:
        "No problem! Your appointment booking has been cancelled.\nFeel free to start again anytime. 💙",
      buttonType: null,
    };
  }

  // ── Global rule: "edit" or "change" free-text at any active state → EDIT_MENU
  if (
    (msgLower === "edit" || msgLower === "change") &&
    step !== STEPS.BOOKING_COMPLETE &&
    step !== STEPS.EDIT_MENU
  ) {
    await session.update({ current_step: STEPS.EDIT_MENU });
    return enterState(session, STEPS.EDIT_MENU, contact, tenantId, null);
  }

  // ── Pre-route: edit button at any non-terminal state ────────────────────
  const isEditButton = Object.prototype.hasOwnProperty.call(EDIT_TARGET_TO_STEP, msg);
  const isTerminalStep = [
    STEPS.EDIT_MENU, STEPS.EDIT_FIELD, STEPS.CONFIRM_BOOKING, STEPS.BOOKING_COMPLETE,
  ].includes(step);
  if (isEditButton && !isTerminalStep) {
    await session.update({ edit_target: msg, previous_step: STEPS.CONFIRM_BOOKING });
    return enterState(session, STEPS.EDIT_FIELD, contact, tenantId, null);
  }

  // ── State dispatch ────────────────────────────────────────────────────────

  // COLLECT_NAME
  if (step === STEPS.COLLECT_NAME) {
    if (!msg) {
      return { success: true, message: "Please enter your name.", buttonType: null };
    }
    await session.update({ patient_name: msg });
    if (session.previous_step === STEPS.CONFIRM_BOOKING) {
      await session.update({ edit_target: null, previous_step: null });
      return enterState(session, STEPS.CONFIRM_BOOKING, contact, tenantId, null);
    }
    return enterState(session, STEPS.COLLECT_EMAIL, contact, tenantId, null);
  }

  // COLLECT_EMAIL
  if (step === STEPS.COLLECT_EMAIL) {
    const email = msg.toLowerCase();
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!valid) {
      return {
        success: true,
        message: "That doesn't look like a valid email. Please try again.",
        buttonType: null,
      };
    }
    await session.update({ patient_email: email });
    if (session.previous_step === STEPS.CONFIRM_BOOKING) {
      await session.update({ edit_target: null, previous_step: null });
      return enterState(session, STEPS.CONFIRM_BOOKING, contact, tenantId, null);
    }
    return enterState(session, STEPS.SELECT_DOCTOR, contact, tenantId, null);
  }

  // SELECT_DOCTOR — accepts only button taps: "doctor_<id>"
  if (step === STEPS.SELECT_DOCTOR) {
    if (msg.startsWith("doctor_")) {
      const doctorId = msg.slice("doctor_".length);
      const doctors = await getDoctorListService(tenantId);
      const matched = doctors.find((d) => d.doctor_id === doctorId);
      if (matched) {
        const specialization =
          (matched.specializations || []).map((s) => s.name).join(", ") || "General";
        await session.update({
          doctor_id: matched.doctor_id,
          doctor_name: matched.name,
          doctor_specialization: specialization,
          draft_json: clearSlotSelectionDraft(session),
        });
        if (session.previous_step === STEPS.CONFIRM_BOOKING) {
          await session.update({ edit_target: null, previous_step: null });
          return enterState(session, STEPS.CONFIRM_BOOKING, contact, tenantId, null);
        }
        return enterState(session, STEPS.SELECT_DATE, contact, tenantId, null);
      }
    }
    // Invalid / free-text in a button-only state → fallback to query mode
    return {
      success: true,
      fallback: true,
      resumeStep: STEPS.SELECT_DOCTOR,
      buttonType: null,
      message: null,
    };
  }

  // SELECT_DATE — accepts only button taps: "date_YYYY-MM-DD"
  if (step === STEPS.SELECT_DATE) {
    if (msg.startsWith("date_")) {
      const dateStr = msg.slice("date_".length);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        await session.update({
          date: dateStr,
          time: null,
          draft_json: clearSlotSelectionDraft(session),
        });
        // Always move to SELECT_TIME after date selection
        // (even during "edit date" — time needs to be re-chosen for the new date)
        return enterState(session, STEPS.SELECT_TIME, contact, tenantId, null);
      }
    }
    // Invalid / free-text in a button-only state → fallback to query mode
    return {
      success: true,
      fallback: true,
      resumeStep: STEPS.SELECT_DATE,
      buttonType: null,
      message: null,
    };
  }

  // SELECT_TIME — accepts grouped slot ranges, final SLOT_* rows, legacy
  // "slot_HH-MM-AM" buttons, or already-decoded "HH:MM AM" text.
  if (step === STEPS.SELECT_TIME) {
    const draft = readSessionDraft(session);
    const slotSelection = draft.slotSelection || null;
    const resolvedSlot = resolveSlotSelection(msg, slotSelection);

    if (resolvedSlot?.type === "group") {
      const selectedGroupId = resolvedSlot.group.id;
      const nextSlotSelection = {
        ...slotSelection,
        selectedGroupId,
      };
      await session.update({
        draft_json: {
          ...draft,
          slotSelection: nextSlotSelection,
        },
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      });
      const slotRows = getSlotSelectionRows(nextSlotSelection, selectedGroupId);
      return {
        success: true,
        message: slotRows.message,
        buttonType: "slot_selection",
        doctorName: session.doctor_name || null,
        dateLabel: formatDateLong(session.date),
        slotSelectionMode: slotRows.mode,
        slotSectionTitle: slotRows.sectionTitle,
        slots: slotRows.rows,
      };
    }

    const timeStr = resolvedSlot?.type === "slot" ? resolvedSlot.slot.time : null;
    if (timeStr) {
      await session.update({
        time: timeStr,
        draft_json: clearSlotSelectionDraft(session),
      });
      if (session.previous_step === STEPS.CONFIRM_BOOKING) {
        await session.update({ edit_target: null, previous_step: null });
        return enterState(session, STEPS.CONFIRM_BOOKING, contact, tenantId, null);
      }
      return enterState(session, STEPS.COLLECT_REASON, contact, tenantId, null);
    }
    // Invalid / free-text in a button-only state → fallback to query mode
    return {
      success: true,
      fallback: true,
      resumeStep: STEPS.SELECT_TIME,
      buttonType: null,
      message: null,
    };
  }

  // COLLECT_REASON — free text, min 3 chars
  if (step === STEPS.COLLECT_REASON) {
    if (msg.length < 3) {
      return {
        success: true,
        message: "Please describe the reason for your visit (at least 3 characters).",
        buttonType: null,
      };
    }
    await session.update({ reason: msg });
    if (session.previous_step === STEPS.CONFIRM_BOOKING) {
      await session.update({ edit_target: null, previous_step: null });
      return enterState(session, STEPS.CONFIRM_BOOKING, contact, tenantId, null);
    }
    return enterState(session, STEPS.CONFIRM_BOOKING, contact, tenantId, null);
  }

  // CONFIRM_BOOKING — free-text yes/no (buttons handled by handleConfirmation)
  if (step === STEPS.CONFIRM_BOOKING) {
    const raw = msg.toLowerCase();
    if (/^(yes|y|confirm|ok|sure|book|proceed)/.test(raw) || raw === "confirm_booking") {
      await session.update({ current_step: "processing" });
      return _executeBooking(session, contact, tenantId);
    }
    if (/^(no|n|cancel|nope|stop)/.test(raw) || raw === "confirm_no") {
      await session.update({
        status: "cancelled",
        draft_json: clearSlotSelectionDraft(session),
      });
      return {
        success: true,
        message: "No problem, I've cancelled that. Let me know if you need anything else.",
        buttonType: null,
      };
    }
    return enterState(session, STEPS.CONFIRM_BOOKING, contact, tenantId, null);
  }

  // EDIT_MENU — decode edit option button
  if (step === STEPS.EDIT_MENU) {
    if (EDIT_TARGET_TO_STEP[msg]) {
      await session.update({ edit_target: msg, previous_step: STEPS.CONFIRM_BOOKING });
      return enterState(session, STEPS.EDIT_FIELD, contact, tenantId, null);
    }
    // Free-text in EDIT_MENU → answer question, re-send menu
    return {
      success: true,
      fallback: true,
      resumeStep: STEPS.EDIT_MENU,
      buttonType: null,
      message: null,
    };
  }

  // ── Resume marker: controller re-sends current state prompt after answering
  //    a side question (fallback-to-query mode).  Re-enter current state cleanly.
  if (msg.startsWith("__resume_")) {
    return enterState(session, step, contact, tenantId, null);
  }

  // Fallback — re-enter current state
  return enterState(session, step, contact, tenantId, null);
};

// ─── handleConfirmation ───────────────────────────────────────────────────────
// Called by the controller BEFORE button routing for every message.
// Handles only legacy cancel/reschedule confirmations. New booking uses Advanced Appointment.
export const handleConfirmation = async (messageOrButtonId, contact, tenantId) => {
  const session = await db.BookingSessions.findOne({
    where: {
      contact_id: contact.contact_id,
      tenant_id: tenantId,
      status: "active",
      flow_type: ["edit", "cancel"],
      current_step: "confirming",
    },
    order: [["updatedAt", "DESC"]],
  });

  if (!session) return null; // No session awaiting confirmation

  const raw = String(messageOrButtonId || "").toLowerCase().trim();

  // ── Legacy flow: "confirming" step (cancel / reschedule) ───────────────────
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
    await session.update({
      status: "cancelled",
      draft_json: clearSlotSelectionDraft(session),
    });
    return {
      success: true,
      message: "No problem, I've cancelled that. Let me know if you need anything else.",
      buttonType: null,
    };
  }

  // YES — execute legacy cancel / reschedule action
  await session.update({ current_step: "processing" });

  try {
    if (session.flow_type === "cancel" && session.appointment_id) {
      const ownedAppointment = await getOwnedAppointmentForContact(
        tenantId, contact.contact_id, session.appointment_id,
      );
      if (!ownedAppointment) throw new Error("Appointment not found for this contact.");

      await deleteAppointmentService(tenantId, session.appointment_id);
      try {
        const io = getIO();
        io.to(`tenant-${tenantId}`).emit("appointment:cancelled", {
          appointment_id: session.appointment_id,
        });
      } catch {}
      await session.update({
        status: "completed",
        draft_json: clearSlotSelectionDraft(session),
      });
      return {
        success: true,
        message: "✅ Your appointment has been *cancelled* successfully.",
        buttonType: null,
      };
    }

    if (session.flow_type === "edit" && session.appointment_id) {
      const ownedAppointment = await getOwnedAppointmentForContact(
        tenantId, contact.contact_id, session.appointment_id,
      );
      if (!ownedAppointment) throw new Error("Appointment not found for this contact.");

      await updateAppointmentService(tenantId, session.appointment_id, {
        appointment_date: session.date,
        appointment_time: session.time,
        doctor_id: session.doctor_id || ownedAppointment.doctor_id,
      });
      try {
        const io = getIO();
        io.to(`tenant-${tenantId}`).emit("appointment:updated", {
          appointment_id: session.appointment_id,
          appointment_date: session.date,
          appointment_time: session.time,
          doctor_id: session.doctor_id || ownedAppointment.doctor_id,
        });
      } catch {}
      await session.update({
        status: "completed",
        draft_json: clearSlotSelectionDraft(session),
      });
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

    // Fallback: treat as new booking (legacy confirming path)
    const phone = String(contact.phone || contact.phone_number || "");
    const { contactNumber, countryCode } = splitPhoneNumber(
      phone, contact.country_code || "+91",
    );
    const created = await createAppointmentService({
      tenant_id: tenantId,
      doctor_id: session.doctor_id || null,
      patient_name: session.patient_name || contact.name,
      contact_number: contactNumber,
      country_code: countryCode,
      appointment_date: session.date,
      appointment_time: session.time,
      age: session.age || null,
      notes: session.reason || null,
      contact_id: contact.contact_id,
      email: session.patient_email || session.email || null,
    });
    try {
      const io = getIO();
      io.to(`tenant-${tenantId}`).emit("appointment:created", {
        appointment_id: created.appointment_id,
        patient_name: created.patient_name,
        doctor_name: session.doctor_name || null,
        appointment_date: created.appointment_date || session.date,
        appointment_time: created.appointment_time || session.time,
        token_number: created.token_number,
      });
    } catch {}
    await session.update({
      status: "completed",
      draft_json: clearSlotSelectionDraft(session),
    });
    return {
      success: true,
      message:
        `✅ *Appointment Confirmed!*\n\n` +
        `*Patient:* ${session.patient_name || contact.name}\n` +
        `*Doctor:* Dr. ${session.doctor_name || "—"}\n` +
        `*Date:* ${formatDateLong(session.date)}\n` +
        `*Time:* ${session.time}\n` +
        `*Token:* #${created.token_number}\n\n` +
        `See you soon! 🏥`,
      buttonType: "post_booking",
      tokenNumber: created.token_number,
    };
  } catch (err) {
    console.error("[APPT-CONV] handleConfirmation error:", err.message);
    await session.update({
      current_step: session.flow_type === "book" ? STEPS.CONFIRM_BOOKING : "confirming",
    });
    return {
      success: false,
      message: `Sorry, there was an issue: ${err.message}\n\nPlease try again.`,
      buttonType: null,
    };
  }
};

// ─── handleAppointmentIntent ──────────────────────────────────────────────────
// Public router called by the WhatsApp controller.
// create_appointment / APPOINTMENT_ACTION → new 10-state handleMessage.
// Other intents (cancel, reschedule, view) → existing flows below.
export const handleAppointmentIntent = async (intent, message, contact, tenantId) => {
  if (!message || typeof message !== "string") {
    return {
      success: false,
      message: "Sorry, I can only handle text messages for appointments. Please type your request.",
      buttonType: null,
    };
  }

  switch (intent) {
    case "create_appointment":
    case "APPOINTMENT_ACTION":
      return handleMessage(message, contact, tenantId);

    case "view_my_appointments":
      return handleViewFlow(contact, tenantId);

    case "reschedule_appointment": {
      const { session, wasExpired } = await getOrCreateSession(
        contact.contact_id, tenantId, "edit",
      );
      return handleRescheduleFlow(session, message, contact, tenantId, wasExpired);
    }

    case "cancel_appointment": {
      const { session, wasExpired } = await getOrCreateSession(
        contact.contact_id, tenantId, "cancel",
      );
      return handleCancelFlow(session, message, contact, tenantId, wasExpired);
    }

    case "list_available_doctors": {
      const doctors = await getDoctorListService(tenantId).catch(() => []);
      if (!doctors?.length) {
        return {
          success: true,
          message: "No doctors are currently available. Please contact us directly.",
          buttonType: null,
        };
      }
      const formatted = doctors.slice(0, 10).map((d) => ({
        id: `doctor_${d.doctor_id}`,
        name: d.name,
        specialization:
          (d.specializations || []).map((s) => s.name).join(", ") || "General",
      }));
      return {
        success: true,
        message: "Here are our available doctors:",
        buttonType: "doctor_list",
        doctors: formatted,
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

// ─── handleViewFlow ───────────────────────────────────────────────────────────
export const handleViewFlow = async (contact, tenantId) => {
  const appointments = await getActiveAppointmentsByContactService(
    tenantId, contact.contact_id,
  );
  if (!appointments || appointments.length === 0) {
    return {
      success: true,
      message: "You have no upcoming appointments.\n\nWould you like to book one?",
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

// ─── handleCancelFlow ─────────────────────────────────────────────────────────
export const handleCancelFlow = async (session, message, contact, tenantId, wasExpired = false) => {
  const directCancelId = String(message).startsWith("cancel_")
    ? message.slice("cancel_".length)
    : null;

  const appointments = await getActiveAppointmentsByContactService(
    tenantId, contact.contact_id,
  );
  if (!appointments || appointments.length === 0) {
    return { success: true, message: "You have no active appointments to cancel.", buttonType: null };
  }

  let target = null;
  if (directCancelId) {
    target = appointments.find((a) => a.appointment_id === directCancelId) || null;
  }
  if (!target && appointments.length === 1) {
    target = appointments[0];
  }
  if (!target) {
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

  await session.update({
    appointment_id: target.appointment_id,
    flow_type: "cancel",
    current_step: "confirming",
    expires_at: new Date(Date.now() + SESSION_TTL_MS),
  });
  return {
    success: true,
    message:
      `Are you sure you want to cancel your appointment?\n\n` +
      `*Doctor:* Dr. ${target.doctor?.name || "—"}\n` +
      `*Date:* ${formatDateLong(target.appointment_date)}\n` +
      `*Time:* ${target.appointment_time}`,
    buttonType: "cancel_confirmation",
  };
};

// ─── handleRescheduleFlow ─────────────────────────────────────────────────────
export const handleRescheduleFlow = async (session, message, contact, tenantId, wasExpired = false) => {
  const directRescheduleId = String(message).startsWith("reschedule_")
    ? message.slice("reschedule_".length)
    : null;

  const appointments = await getActiveAppointmentsByContactService(
    tenantId, contact.contact_id,
  );
  if (!appointments || appointments.length === 0) {
    return { success: true, message: "You have no active appointments to reschedule.", buttonType: null };
  }

  let target = null;
  if (directRescheduleId) {
    target = appointments.find((a) => a.appointment_id === directRescheduleId) || null;
  }
  if (!target && appointments.length === 1) {
    target = appointments[0];
  }
  if (!target) {
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

  await session.update({
    appointment_id: target.appointment_id,
    doctor_id: target.doctor_id,
    doctor_name: target.doctor?.name || null,
    flow_type: "edit",
    current_step: "confirming",
    expires_at: new Date(Date.now() + SESSION_TTL_MS),
  });
  return {
    success: true,
    message: `Sure! What new date and time would you like for your appointment with Dr. ${target.doctor?.name || "your doctor"}?`,
    buttonType: null,
  };
};

// ─── cleanupExpiredSessions ───────────────────────────────────────────────────
export const cleanupExpiredSessions = async () => {
  try {
    const [, meta] = await db.sequelize.query(
      `UPDATE booking_sessions
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'active' AND expires_at < NOW()`,
    );
    const count = meta?.affectedRows ?? 0;
    if (count > 0) {
      console.log(`[SESSION-CLEANUP] Expired ${count} stale booking session(s)`);
    }
  } catch (err) {
    console.error("[SESSION-CLEANUP] Error:", err.message);
  }
};

// ─── appointmentOrchestrator ──────────────────────────────────────────────────
export const appointmentOrchestrator = {
  getOrCreateSession,
  handleMessage,
  handleAppointmentIntent,
  handleConfirmation,
  cleanupExpiredSessions,
};
