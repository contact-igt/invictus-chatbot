import db from "../../database/index.js";
import { Op } from "sequelize";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import {
  formatTimeToAMPM,
  timeToMinutes,
} from "../../utils/helpers/formatTime.js";
import { tableNames } from "../../database/tableName.js";
import { formatPhoneNumber } from "../../utils/helpers/formatPhoneNumber.js";
import {
  createContactService,
  getContactByPhoneAndTenantIdService,
} from "../ContactsModel/contacts.service.js";
import { sendEmail } from "../../utils/email/emailService.js";
import {
  buildAppointmentEmailHtml,
  buildAppointmentEmailSubject,
  formatAppointmentDate,
} from "../../utils/email/appointmentEmailTemplate.js";

// Normalize time to consistent "HH:MM AM/PM" format for reliable comparisons
const normalizeTimeFormat = (time) => {
  if (!time) return time;
  // If already in AM/PM format, normalize padding
  if (time.includes("AM") || time.includes("PM")) {
    const [timePart, period] = time.trim().split(/\s+/);
    const [h, m] = timePart.split(":");
    const hour = parseInt(h, 10);
    const displayHour = hour < 10 ? `0${hour}` : `${hour}`;
    const displayMinutes = String(m || "00").padStart(2, "0");
    return `${displayHour}:${displayMinutes} ${period.toUpperCase()}`;
  }
  // Otherwise convert from 24h format
  return formatTimeToAMPM(time);
};

const DATE_ONLY_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})/;

const toLocalDateOnly = (dateObj) =>
  `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;

const normalizeDateOnly = (value, fieldName = "date") => {
  if (!value) return value;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Invalid ${fieldName} value.`);
    }
    return toLocalDateOnly(value);
  }

  const raw = String(value).trim();
  const prefixed = raw.match(DATE_ONLY_PREFIX_REGEX);
  if (prefixed) {
    return prefixed[1];
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName} format. Expected YYYY-MM-DD.`);
  }

  return toLocalDateOnly(parsed);
};

const nextDateOnly = (dateOnly) => {
  const d = new Date(`${dateOnly}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return toLocalDateOnly(d);
};

const buildAppointmentDateWhere = (dateValue) => {
  const normalized = normalizeDateOnly(dateValue, "appointment_date");
  return {
    [Op.gte]: normalized,
    [Op.lt]: nextDateOnly(normalized),
  };
};

const toUtcMidnightIso = (dateOnly) => `${dateOnly}T00:00:00.000Z`;

const getDayOfWeekFromDate = (date) => {
  const dateObj = new Date(`${date}T12:00:00`);
  const days = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  return days[dateObj.getDay()];
};

const ALLOWED_FOLLOW_UP_TYPES = new Set(["Call", "Visit", "WhatsApp"]);
const BOOKED_SLOT_STATUSES = ["Pending", "Confirmed", "Rescheduled"];

const createFollowUpPlaceholder = async ({
  appointment_id,
  tenant_id,
  follow_up_date,
  follow_up_type,
}) => {
  // Placeholder hook for future follow-up system integration.
  console.log(
    `[APPOINTMENT-OUTCOME] Follow-up queued for future module: appointment=${appointment_id}, tenant=${tenant_id}, date=${follow_up_date}, type=${follow_up_type}`,
  );
};

const parseBooleanFlag = (value) =>
  value === true || value === "true" || value === 1 || value === "1";
const isAppointmentsDebugEnabled = process.env.DEBUG_APPOINTMENTS === "true";

const resolveLeadIdForAppointment = async (tenant_id, lead_id, contact_id) => {
  const normalizedLeadId = lead_id ? String(lead_id).trim() : "";

  try {
    if (normalizedLeadId) {
      const lead = await db.Leads.findOne({
        where: {
          tenant_id,
          lead_id: normalizedLeadId,
          is_deleted: false,
        },
        attributes: ["lead_id"],
        raw: true,
      });

      if (!lead) {
        console.warn(
          `[APPOINTMENT] Ignoring unknown lead_id '${normalizedLeadId}' for tenant '${tenant_id}'`,
        );
        return null;
      }

      return lead.lead_id;
    }

    // Fallback: when lead_id not passed, derive from contact_id for linkage safety.
    if (contact_id) {
      const leadByContact = await db.Leads.findOne({
        where: {
          tenant_id,
          contact_id,
          is_deleted: false,
        },
        attributes: ["lead_id"],
        order: [["created_at", "DESC"]],
        raw: true,
      });
      return leadByContact?.lead_id || null;
    }

    return null;
  } catch (err) {
    console.warn(
      `[APPOINTMENT] lead_id verification skipped for '${normalizedLeadId || contact_id || "unknown"}': ${err.message}`,
    );
    // Strict integrity: persist lead_id only when validation succeeds.
    return null;
  }
};

const getAvailabilityRowsForDate = async ({
  tenant_id,
  doctor_id,
  date,
  transaction = null,
}) => {
  return db.DoctorAvailability.findAll({
    where: {
      doctor_id,
      tenant_id,
      day_of_week: getDayOfWeekFromDate(date),
    },
    order: [["start_time", "ASC"]],
    transaction,
  });
};

const getDurationFromAvailabilityRow = (row, fallbackDuration = 30) => {
  if (!row) return fallbackDuration;
  const start = timeToMinutes(row.start_time);
  const end = timeToMinutes(row.end_time);
  return end > start ? end - start : fallbackDuration;
};

const findAvailabilityRowForTime = (availabilityRows = [], time) => {
  const requestedStart = timeToMinutes(normalizeTimeFormat(time));
  return availabilityRows.find(
    (row) => timeToMinutes(row.start_time) === requestedStart,
  );
};

const getDurationForAppointmentTime = ({
  availabilityRows = [],
  appointmentTime,
  fallbackDuration = 30,
}) => {
  const row = findAvailabilityRowForTime(availabilityRows, appointmentTime);
  return getDurationFromAvailabilityRow(row, fallbackDuration);
};

export const createAppointmentService = async (data) => {
  let {
    tenant_id,
    contact_id,
    lead_id,
    doctor_id,
    patient_name,
    country_code,
    contact_number,
    appointment_date,
    age,
    notes,
    email,
    branch_name,
    service_name,
    slot_id,
    send_creation_email = true,
    creation_email_type = "Confirmed",
  } = data;

  let { appointment_time } = data;

  // Auto-split phone
  const rawDigits = contact_number // NEW
    ? contact_number.toString().replace(/\D/g, "") // NEW
    : ""; // NEW
  let phone = rawDigits; // NEW
  let cc = country_code || "+91"; // NEW

  // WhatsApp numbers can include country code (e.g., 919876543210) — strip prefix first // NEW
  if (rawDigits.length > 10) {
    // NEW
    const inferredCcDigits = rawDigits.slice(0, -10); // NEW
    phone = rawDigits.slice(-10); // NEW
    if (!country_code && inferredCcDigits) cc = `+${inferredCcDigits}`; // NEW
  } // NEW

  if (cc && !cc.startsWith("+")) {
    // NEW
    cc = `+${cc.toString().replace(/\D/g, "")}`; // NEW
  } // NEW

  contact_number = phone; // NEW
  country_code = cc; // NEW

  // Validate mobile is exactly 10 digits (after stripping any country code) // NEW
  if (contact_number && contact_number.length !== 10) {
    // NEW
    throw new Error("Mobile number must be exactly 10 digits."); // NEW
  } // NEW

  // Normalize time to consistent format (e.g. "09:00 AM" not "9:00 AM")
  appointment_time = normalizeTimeFormat(appointment_time);
  appointment_date = normalizeDateOnly(appointment_date, "appointment_date");
  if (isAppointmentsDebugEnabled) {
    console.log("[APPOINTMENT-CREATE] normalized payload:", {
      tenant_id,
      contact_id,
      doctor_id,
      appointment_date,
      appointment_date_midnight_utc: toUtcMidnightIso(appointment_date),
      appointment_time,
    });
  }

  let doctor = null;
  let doctorDuration = 30;

  if (!appointment_time) {
    throw new Error("Appointment time is required.");
  }

  if (!appointment_date) {
    throw new Error("Appointment date is required.");
  }

  if (!patient_name) {
    throw new Error("Patient name is required.");
  }

  if (doctor_id) {
    doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id, is_deleted: false },
      attributes: ["doctor_id", "status", "consultation_duration"],
    });

    if (!doctor) {
      throw new Error("Selected doctor was not found.");
    }

    if (doctor.status !== "available") {
      throw new Error("Selected doctor is currently unavailable.");
    }

    const availabilityRows = await getAvailabilityRowsForDate({
      tenant_id,
      doctor_id,
      date: appointment_date,
    });

    if (!availabilityRows.length) {
      throw new Error("Selected doctor does not work on the chosen date.");
    }

    const selectedAvailability = findAvailabilityRowForTime(
      availabilityRows,
      appointment_time,
    );
    if (!selectedAvailability) {
      throw new Error("Selected time is not available for this doctor.");
    }

    doctorDuration = getDurationFromAvailabilityRow(
      selectedAvailability,
      doctor.consultation_duration || 30,
    );
  }

  // Resolve contact_id from contact_number if not provided
  if (!contact_id && contact_number) {
    const existingContact = await getContactByPhoneAndTenantIdService(
      tenant_id,
      contact_number,
    );
    if (existingContact) {
      contact_id = existingContact.contact_id;
    } else {
      // Contact doesn't exist — create a new one
      const newContact = await createContactService(
        tenant_id,
        contact_number,
        patient_name || null,
        null,
        country_code,
        null,
        email || null,
        age || null,
      );
      contact_id = newContact.contact_id;
    }
  }

  if (!contact_id) {
    throw new Error(
      "Contact not found and could not be created. Please provide a valid contact number.",
    );
  }

  const resolvedLeadId = await resolveLeadIdForAppointment(
    tenant_id,
    lead_id,
    contact_id,
  );
  const appointmentLeadId = resolvedLeadId || null;
  const status = "Pending";

  // Use a transaction to prevent race conditions on duplicate/slot checks
  const transaction = await db.sequelize.transaction();

  try {
    // 1. Check for duplicate booking (same patient, same doctor, same date+time)
    const existingPatient = await db.Appointments.findOne({
      where: {
        tenant_id,
        contact_id,
        is_deleted: false,
        appointment_date: buildAppointmentDateWhere(appointment_date),
        appointment_time,
        status: { [Op.not]: "Cancelled" },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingPatient) {
      throw new Error("You already have an appointment booked for this time.");
    }

    // 2. Check for doctor slot conflict using overlap logic, not exact time equality.
    if (doctor_id) {
      const requestedStart = timeToMinutes(appointment_time);
      const requestedEnd = requestedStart + doctorDuration;

      const doctorAppointments = await db.Appointments.findAll({
        where: {
          tenant_id,
          doctor_id,
          is_deleted: false,
          appointment_date: buildAppointmentDateWhere(appointment_date),
          status: { [Op.in]: BOOKED_SLOT_STATUSES },
        },
        attributes: ["appointment_time"],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      const doctorSlotConflict = doctorAppointments.some((appt) => {
        const apptStart = timeToMinutes(appt.appointment_time);
        const apptEnd = apptStart + doctorDuration;
        return requestedStart < apptEnd && requestedEnd > apptStart;
      });

      if (doctorSlotConflict) {
        throw new Error(
          "This time slot is already booked for the selected doctor. Please choose another time.",
        );
      }
    }

    // 3. Generate Unique Appointment ID and Token Number (inside transaction for consistency)
    // Lock the doctor record to serialize bookings for this specific doctor and prevent race conditions
    if (doctor_id) {
      await db.Doctors.findOne({
        where: { doctor_id, tenant_id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
    }

    const appointment_id = await generateReadableIdFromLast(
      tableNames.APPOINTMENTS,
      "appointment_id",
      "AP",
      3,
      transaction,
    );

    const count = await db.Appointments.count({
      where: {
        tenant_id,
        doctor_id,
        is_deleted: false,
        appointment_date: buildAppointmentDateWhere(appointment_date),
      },
      transaction,
    });
    const token_number = count + 1;

    const appointment = await db.Appointments.create(
      {
        appointment_id: appointment_id,
        tenant_id,
        doctor_id,
        contact_id,
        lead_id: appointmentLeadId,
        patient_name,
        country_code,
        contact_number,
        appointment_date,
        appointment_time,
        age,
        status,
        token_number,
        notes: notes || null,
        email,
        branch_name: branch_name || null,
        service_name: service_name || null,
        slot_id: slot_id || null,
      },
      { transaction },
    );

    // 4. Increment doctor's appointment count
    if (doctor_id) {
      await db.Doctors.increment("appointment_count", {
        by: 1,
        where: { doctor_id, tenant_id },
        transaction,
      });
    }

    await transaction.commit();

    if (send_creation_email) {
      sendAppointmentNotificationEmail(
        tenant_id,
        appointment_id,
        creation_email_type,
      ).catch((err) =>
        console.error("[APPOINTMENT-EMAIL] Initial send failed:", err.message),
      );
    }

    return appointment;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const getActiveAppointmentsByContactService = async (
  tenant_id,
  contact_id,
) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await db.Appointments.findAll({
      where: {
        tenant_id,
        contact_id,
        is_deleted: false,
        status: { [Op.in]: BOOKED_SLOT_STATUSES },
        appointment_date: { [Op.gte]: today },
      },
      include: [
        {
          model: db.Doctors,
          as: "doctor",
          attributes: ["doctor_id", "name", "title"],
        },
      ],
      order: [["appointment_date", "ASC"]],
    });
  } catch (err) {
    throw err;
  }
};

/**
 * Fetches recent active and recently cancelled/deleted appointments
 * for AI context to prevent "memory vs reality" disparity.
 */
export const getRecentAppointmentsForAIService = async (
  tenant_id,
  contact_id,
) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Also include appointments cancelled in the last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return await db.Appointments.findAll({
      where: {
        tenant_id,
        contact_id,
        [Op.or]: [
          // Active appointments
          {
            is_deleted: false,
            status: { [Op.in]: ["Pending", "Confirmed", "Rescheduled", "Completed"] },
            appointment_date: {
              [Op.gte]: new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000),
            },
          },
          // Recently cancelled/deleted appointments
          {
            [Op.or]: [{ status: "Cancelled" }, { is_deleted: true }],
            updated_at: { [Op.gte]: yesterday },
          },
        ],
      },
      include: [
        {
          model: db.Doctors,
          as: "doctor",
          attributes: ["doctor_id", "name", "title"],
        },
      ],
      order: [["appointment_date", "ASC"]],
    });
  } catch (err) {
    throw err;
  }
};

export const createAppointmentOutcomeService = async ({
  tenant_id,
  appointment_id,
  notes,
  follow_up_required = false,
  follow_up_date = null,
  follow_up_type = null,
}) => {
  const normalizedNotes = typeof notes === "string" ? notes.trim() : "";
  if (!normalizedNotes) {
    throw new Error("Visit notes are required.");
  }

  const appointment = await db.Appointments.findOne({
    where: { tenant_id, appointment_id, is_deleted: false },
    attributes: ["appointment_id"],
    raw: true,
  });

  if (!appointment) {
    throw new Error("Appointment not found");
  }

  const requiresFollowUp = parseBooleanFlag(follow_up_required);

  const safeFollowUpDate = requiresFollowUp ? follow_up_date || null : null;
  const safeFollowUpType = requiresFollowUp ? follow_up_type || null : null;

  if (requiresFollowUp && !safeFollowUpDate) {
    throw new Error("Follow-up date is required when follow-up is enabled.");
  }

  if (requiresFollowUp && !safeFollowUpType) {
    throw new Error("Follow-up type is required when follow-up is enabled.");
  }

  if (safeFollowUpType && !ALLOWED_FOLLOW_UP_TYPES.has(safeFollowUpType)) {
    throw new Error("Invalid follow-up type.");
  }

  const outcome = await db.sequelize.transaction(async (transaction) => {
    const existingOutcome = await db.AppointmentOutcomes.findOne({
      where: { appointment_id, tenant_id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingOutcome) {
      await existingOutcome.update(
        {
          notes: normalizedNotes,
          follow_up_required: requiresFollowUp,
          follow_up_date: safeFollowUpDate,
          follow_up_type: safeFollowUpType,
        },
        { transaction },
      );
      return existingOutcome;
    }

    return db.AppointmentOutcomes.create(
      {
        appointment_id,
        tenant_id,
        notes: normalizedNotes,
        follow_up_required: requiresFollowUp,
        follow_up_date: safeFollowUpDate,
        follow_up_type: safeFollowUpType,
      },
      { transaction },
    );
  });

  if (requiresFollowUp) {
    await createFollowUpPlaceholder({
      appointment_id,
      tenant_id,
      follow_up_date: safeFollowUpDate,
      follow_up_type: safeFollowUpType,
    });
  }

  return outcome;
};

export const completeAppointmentWithOutcomeService = async ({
  tenant_id,
  appointment_id,
  notes,
  follow_up_required = false,
  follow_up_date = null,
  follow_up_type = null,
}) => {
  return db.sequelize.transaction(async (transaction) => {
    const appointment = await db.Appointments.findOne({
      where: { tenant_id, appointment_id, is_deleted: false },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!appointment) {
      throw new Error("Appointment not found");
    }

    const normalizedNotes = typeof notes === "string" ? notes.trim() : "";
    if (!normalizedNotes) {
      throw new Error("Visit notes are required.");
    }

    const requiresFollowUp = parseBooleanFlag(follow_up_required);
    const safeFollowUpDate = requiresFollowUp ? follow_up_date || null : null;
    const safeFollowUpType = requiresFollowUp ? follow_up_type || null : null;

    if (requiresFollowUp && !safeFollowUpDate) {
      throw new Error("Follow-up date is required when follow-up is enabled.");
    }
    if (requiresFollowUp && !safeFollowUpType) {
      throw new Error("Follow-up type is required when follow-up is enabled.");
    }
    if (safeFollowUpType && !ALLOWED_FOLLOW_UP_TYPES.has(safeFollowUpType)) {
      throw new Error("Invalid follow-up type.");
    }

    const existingOutcome = await db.AppointmentOutcomes.findOne({
      where: { appointment_id, tenant_id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingOutcome) {
      await existingOutcome.update(
        {
          notes: normalizedNotes,
          follow_up_required: requiresFollowUp,
          follow_up_date: safeFollowUpDate,
          follow_up_type: safeFollowUpType,
        },
        { transaction },
      );
    } else {
      await db.AppointmentOutcomes.create(
        {
          appointment_id,
          tenant_id,
          notes: normalizedNotes,
          follow_up_required: requiresFollowUp,
          follow_up_date: safeFollowUpDate,
          follow_up_type: safeFollowUpType,
        },
        { transaction },
      );
    }

    await appointment.update({ status: "Completed" }, { transaction });

    if (requiresFollowUp) {
      await createFollowUpPlaceholder({
        appointment_id,
        tenant_id,
        follow_up_date: safeFollowUpDate,
        follow_up_type: safeFollowUpType,
      });
    }

    return { appointment_id, status: "Completed" };
  });
};

export const markNoShowWithActionService = async ({
  tenant_id,
  appointment_id,
  action,
  follow_up_date = null,
  follow_up_type = null,
}) => {
  return db.sequelize.transaction(async (transaction) => {
    const appointment = await db.Appointments.findOne({
      where: { tenant_id, appointment_id, is_deleted: false },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!appointment) {
      throw new Error("Appointment not found");
    }

    const normalizedAction = String(action || "").trim().toLowerCase();
    if (!["follow_up", "close"].includes(normalizedAction)) {
      throw new Error("Invalid no-show action.");
    }

    if (normalizedAction === "follow_up") {
      if (!follow_up_date) {
        throw new Error("Follow-up date is required.");
      }
      if (!follow_up_type) {
        throw new Error("Follow-up type is required.");
      }
      if (!["Call", "WhatsApp"].includes(follow_up_type)) {
        throw new Error("Invalid follow-up type.");
      }

      const existingOutcome = await db.AppointmentOutcomes.findOne({
        where: { appointment_id, tenant_id },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      const payload = {
        notes: "No show - follow-up scheduled",
        follow_up_required: true,
        follow_up_date,
        follow_up_type,
      };

      if (existingOutcome) {
        await existingOutcome.update(payload, { transaction });
      } else {
        await db.AppointmentOutcomes.create(
          {
            appointment_id,
            tenant_id,
            ...payload,
          },
          { transaction },
        );
      }

      await createFollowUpPlaceholder({
        appointment_id,
        tenant_id,
        follow_up_date,
        follow_up_type,
      });
    }

    await appointment.update({ status: "Noshow" }, { transaction });
    return { appointment_id, status: "Noshow" };
  });
};

export const getAppointmentsByContactIdService = async (
  tenant_id,
  contact_id,
  { includeLead = false } = {},
) => {
  try {
    const include = [];
    if (includeLead) {
      include.push({
        model: db.Leads,
        as: "lead",
        required: false,
      });
    }

    return await db.Appointments.findAll({
      where: { tenant_id, contact_id },
      include,
      order: [
        ["appointment_date", "DESC"],
        ["appointment_time", "DESC"],
      ],
    });
  } catch (err) {
    throw err;
  }
};

export const getAllAppointmentsService = async (
  tenant_id,
  { search, status, date, doctor_id, lead_id, includeLead = false } = {},
) => {
  try {
    const where = { tenant_id, is_deleted: false };
    if (status) where.status = status;
    if (date) {
      where.appointment_date = buildAppointmentDateWhere(date);
    }
    if (isAppointmentsDebugEnabled) {
      const normalizedDate = date ? normalizeDateOnly(date, "date") : null;
      console.log("[APPOINTMENT-LIST] filters:", {
        tenant_id,
        search,
        status,
        date,
        normalizedDate,
        startOfDay: normalizedDate
          ? toUtcMidnightIso(normalizedDate)
          : null,
        startOfNextDay: normalizedDate
          ? toUtcMidnightIso(nextDateOnly(normalizedDate))
          : null,
        doctor_id,
        lead_id,
      });
    }
    if (doctor_id) where.doctor_id = doctor_id;
    if (lead_id) where.lead_id = lead_id;
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      where[Op.or] = [
        { patient_name: { [Op.like]: q } },
        { contact_number: { [Op.like]: q } },
      ];
    }

    const include = [
      {
        model: db.Doctors,
        as: "doctor",
        attributes: ["doctor_id", "name", "title"],
      },
    ];

    if (includeLead) {
      include.push({
        model: db.Leads,
        as: "lead",
        required: false,
      });
    }

    return await db.Appointments.findAll({
      where,
      include,
      order: [
        ["appointment_date", "DESC"],
        ["appointment_time", "ASC"],
      ],
    });
  } catch (err) {
    throw err;
  }
};

export const getLastAppointmentService = async (tenant_id, contact_id) => {
  try {
    return await db.Appointments.findOne({
      where: { tenant_id, contact_id, is_deleted: false },
      order: [
        ["appointment_date", "DESC"],
        ["appointment_time", "DESC"],
      ],
    });
  } catch (err) {
    throw err;
  }
};

export const checkAvailabilityService = async (
  tenant_id,
  doctor_id,
  date,
  time,
  excludeAppointmentId = null, // Optional: exclude this appointment from check (for updates)
) => {
  try {
    if (!doctor_id || !date || !time) {
      throw new Error(
        "doctor_id, date, and time are required for availability check.",
      );
    }
    const normalizedDate = normalizeDateOnly(date, "date");

    // 1. Verify doctor exists in database
    const doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id, is_deleted: false },
      attributes: ["consultation_duration", "status"],
    });

    if (!doctor) {
      console.log(
        `[CHECK-AVAILABILITY] Doctor ${doctor_id} not found in database`,
      );
      return false; // Doctor doesn't exist
    }

    if (doctor.status !== "available") {
      console.log(
        `[CHECK-AVAILABILITY] Doctor ${doctor_id} is ${doctor.status}`,
      );
      return false;
    }

    // 2. Verify doctor works on this day
    const dayOfWeek = getDayOfWeekFromDate(normalizedDate);

    const availabilityRows = await getAvailabilityRowsForDate({
      tenant_id,
      doctor_id,
      date,
    });

    if (!availabilityRows.length) {
      console.log(
        `[CHECK-AVAILABILITY] Doctor ${doctor_id} does not work on ${dayOfWeek}`,
      );
      return false; // Doctor doesn't work this day
    }

    const formattedTime = normalizeTimeFormat(time);
    const selectedAvailability = findAvailabilityRowForTime(
      availabilityRows,
      formattedTime,
    );
    if (!selectedAvailability) {
      console.log(
        `[CHECK-AVAILABILITY] ${formattedTime} is not a configured slot for ${doctor_id}`,
      );
      return false;
    }

    const fallbackDuration = doctor?.consultation_duration || 30;
    const duration = getDurationFromAvailabilityRow(
      selectedAvailability,
      fallbackDuration,
    );
    const requestedStart = timeToMinutes(formattedTime);
    const requestedEnd = requestedStart + duration;

    // Build where clause, optionally excluding a specific appointment (for updates)
    const whereClause = {
      tenant_id,
      doctor_id,
      is_deleted: false,
      appointment_date: buildAppointmentDateWhere(normalizedDate),
      status: { [Op.in]: BOOKED_SLOT_STATUSES },
    };

    if (excludeAppointmentId) {
      whereClause.appointment_id = { [Op.ne]: excludeAppointmentId };
    }

    const existingAppointments = await db.Appointments.findAll({
      where: whereClause,
      attributes: ["appointment_time"],
    });

    const hasOverlap = existingAppointments.some((appt) => {
      const apptStart = timeToMinutes(appt.appointment_time);
      const apptDuration = getDurationForAppointmentTime({
        availabilityRows,
        appointmentTime: appt.appointment_time,
        fallbackDuration,
      });
      const apptEnd = apptStart + apptDuration;
      // Overlap occurs if (StartA < EndB) AND (EndA > StartB)
      return requestedStart < apptEnd && requestedEnd > apptStart;
    });

    return !hasOverlap;
  } catch (err) {
    throw err;
  }
};

// ─── Send appointment notification email (non-blocking) ───
const sendAppointmentNotificationEmail = async (
  tenant_id,
  appointment_id,
  type,
  changes,
) => {
  try {
    const appointment = await db.Appointments.findOne({
      where: { appointment_id, tenant_id },
      include: [
        { model: db.Doctors, as: "doctor", attributes: ["name"] },
        { model: db.Contacts, as: "contact", attributes: ["email", "name"] },
      ],
    });
    if (!appointment) return;

    // Check both appointment and contact for email
    const emailTo = appointment.email || appointment.contact?.email;
    if (!emailTo) return;

    // Fetch tenant company name for email branding
    let companyName = "WhatsNexus";
    try {
      const tenant = await db.Tenants.findOne({
        where: { tenant_id, is_deleted: false },
        attributes: ["company_name"],
        raw: true,
      });
      if (tenant?.company_name) companyName = tenant.company_name;
    } catch (_) {}

    const formattedDate = formatAppointmentDate(appointment.appointment_date);
    const patientName =
      appointment.patient_name || appointment.contact?.name || "Patient";

    const emailHtml = buildAppointmentEmailHtml({
      type,
      patientName,
      appointmentId: appointment.appointment_id,
      tokenNumber: appointment.token_number,
      date: formattedDate,
      time: appointment.appointment_time,
      doctorName: appointment.doctor?.name || null,
      reason: appointment.notes || null,
      changes,
      companyName,
    });

    const subject = buildAppointmentEmailSubject({
      type,
      appointmentId: appointment.appointment_id,
      tokenNumber: appointment.token_number,
      date: formattedDate,
      time: appointment.appointment_time,
    });

    await sendEmail({ to: emailTo, subject, html: emailHtml });
    console.log(
      `[APPOINTMENT-EMAIL] ${type} email sent to ${emailTo} for ${appointment_id}`,
    );
  } catch (emailErr) {
    console.error(
      `[APPOINTMENT-EMAIL] Failed to send ${type} email for ${appointment_id}:`,
      emailErr.message,
    );
  }
};

export const updateAppointmentStatusService = async (
  tenant_id,
  appointment_id,
  status,
  { allowTerminalStatuses = false } = {},
) => {
  try {
    if (
      !allowTerminalStatuses &&
      (status === "Completed" || status === "Noshow")
    ) {
      throw new Error(
        `Direct status update to ${status} is blocked. Use strict lifecycle endpoints.`,
      );
    }

    const [updatedCount] = await db.Appointments.update(
      { status },
      { where: { appointment_id, tenant_id, is_deleted: false } },
    );
    if (updatedCount === 0) {
      throw new Error("Appointment not found");
    }

    // Send email notification for status change (non-blocking)
    sendAppointmentNotificationEmail(tenant_id, appointment_id, status).catch(
      () => {},
    );

    return updatedCount;
  } catch (err) {
    throw err;
  }
};

export const updateAppointmentService = async (
  tenant_id,
  appointment_id,
  data,
) => {
  console.log(
    `[UPDATE-APPOINTMENT-SERVICE] Starting update for ${appointment_id}`,
    { tenant_id, data },
  );

  const transaction = await db.sequelize.transaction();

  try {
    const appointment = await db.Appointments.findOne({
      where: { appointment_id, tenant_id, is_deleted: false },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!appointment) {
      console.error(
        `[UPDATE-APPOINTMENT-SERVICE] Appointment not found: ${appointment_id}`,
      );
      throw new Error("Appointment not found");
    }

    console.log(`[UPDATE-APPOINTMENT-SERVICE] Found appointment:`, {
      id: appointment.appointment_id,
      current_date: appointment.appointment_date,
      current_time: appointment.appointment_time,
    });

    const updateFields = {};
    if (data.patient_name !== undefined)
      updateFields.patient_name = data.patient_name;
    if (data.appointment_date !== undefined)
      updateFields.appointment_date = data.appointment_date;
    if (data.status !== undefined) {
      if (data.status === "Completed" || data.status === "Noshow") {
        throw new Error(
          `Direct status update to ${data.status} is blocked. Use strict lifecycle endpoints.`,
        );
      }
      updateFields.status = data.status;
    }
    if (data.doctor_id !== undefined) updateFields.doctor_id = data.doctor_id;
    if (data.notes !== undefined) updateFields.notes = data.notes;
    if (data.age !== undefined) updateFields.age = data.age;
    if (data.email !== undefined) updateFields.email = data.email;
    if (data.branch_name !== undefined) updateFields.branch_name = data.branch_name;
    if (data.service_name !== undefined) updateFields.service_name = data.service_name;
    if (data.slot_id !== undefined) updateFields.slot_id = data.slot_id;
    if (data.cancelled_at !== undefined) updateFields.cancelled_at = data.cancelled_at;
    if (data.cancelled_by !== undefined) updateFields.cancelled_by = data.cancelled_by;

    if (data.appointment_time !== undefined) {
      updateFields.appointment_time = normalizeTimeFormat(
        data.appointment_time,
      );
    }

    console.log(
      `[UPDATE-APPOINTMENT-SERVICE] Built updateFields:`,
      updateFields,
    );

    if (data.country_code !== undefined) {
      let cc = data.country_code.toString().replace(/\D/g, "");
      updateFields.country_code = `+${cc}`;
    }

    if (data.contact_number !== undefined) {
      let contact_number = data.contact_number.toString().replace(/\D/g, "");
      if (contact_number && contact_number.length !== 10) {
        throw new Error("Mobile number must be exactly 10 digits.");
      }
      updateFields.contact_number = contact_number;
    }

    // Check if there's anything to update after all supported fields are normalized.
    if (Object.keys(updateFields).length === 0) {
      console.error(
        `[UPDATE-APPOINTMENT-SERVICE] No fields to update - rolling back`,
      );
      await transaction.rollback();
      return appointment; // Return existing appointment without changes
    }

    // 1. Check for patient conflict (prevent same patient having two apps at same time)
    const newDate =
      updateFields.appointment_date || appointment.appointment_date;
    const newTime =
      updateFields.appointment_time || appointment.appointment_time;
    const newDoctorId = updateFields.doctor_id || appointment.doctor_id;
    const dateChanged = updateFields.appointment_date !== undefined;
    const timeChanged = updateFields.appointment_time !== undefined;
    const doctorChanged = updateFields.doctor_id !== undefined;

    if (dateChanged || timeChanged) {
      const checkDate = normalizeDateOnly(newDate, "appointment_date");

      const patientConflict = await db.Appointments.findOne({
        where: {
          tenant_id,
          contact_id: appointment.contact_id,
          is_deleted: false,
          id: { [Op.ne]: appointment.id },
          appointment_date: buildAppointmentDateWhere(checkDate),
          appointment_time: newTime,
          status: { [Op.not]: "Cancelled" },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (patientConflict) {
        throw new Error(
          "You already have another appointment booked for this time.",
        );
      }
    }

    // 2. Check for doctor slot conflict if date, time, or doctor is being changed
    if ((dateChanged || timeChanged || doctorChanged) && newDoctorId) {
      const checkDate = normalizeDateOnly(newDate, "appointment_date");

      const doctor = await db.Doctors.findOne({
        where: { doctor_id: newDoctorId, tenant_id, is_deleted: false },
        attributes: ["consultation_duration", "status"],
        transaction,
      });

      if (!doctor) {
        throw new Error("Selected doctor was not found.");
      }

      if (doctor.status !== "available") {
        throw new Error("Selected doctor is currently unavailable.");
      }

      const availabilityRows = await getAvailabilityRowsForDate({
        tenant_id,
        doctor_id: newDoctorId,
        date: checkDate,
        transaction,
      });

      if (!availabilityRows.length) {
        throw new Error("Selected doctor does not work on the chosen date.");
      }

      const selectedAvailability = findAvailabilityRowForTime(
        availabilityRows,
        newTime,
      );
      if (!selectedAvailability) {
        throw new Error("Selected time is not available for this doctor.");
      }

      const fallbackDuration = doctor?.consultation_duration || 30;
      const duration = getDurationFromAvailabilityRow(
        selectedAvailability,
        fallbackDuration,
      );
      const requestedStart = timeToMinutes(newTime);
      const requestedEnd = requestedStart + duration;

      const existingAppointments = await db.Appointments.findAll({
        where: {
          tenant_id,
          doctor_id: newDoctorId,
          is_deleted: false,
          id: { [Op.ne]: appointment.id },
          appointment_date: buildAppointmentDateWhere(checkDate),
          status: { [Op.in]: BOOKED_SLOT_STATUSES },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      const hasOverlap = existingAppointments.some((appt) => {
        const apptStart = timeToMinutes(appt.appointment_time);
        const apptDuration = getDurationForAppointmentTime({
          availabilityRows,
          appointmentTime: appt.appointment_time,
          fallbackDuration,
        });
        const apptEnd = apptStart + apptDuration;
        return requestedStart < apptEnd && requestedEnd > apptStart;
      });

      if (hasOverlap) {
        throw new Error(
          "This time slot is already booked for the selected doctor. Please choose another time.",
        );
      }
    }

    console.log(
      `[UPDATE-APPOINTMENT-SERVICE] Executing DB update with fields:`,
      updateFields,
    );

    const [affectedRows] = await db.Appointments.update(updateFields, {
      where: { appointment_id, tenant_id },
      transaction,
    });

    console.log(
      `[UPDATE-APPOINTMENT-SERVICE] DB update affected ${affectedRows} rows`,
    );

    // 3. Handle doctor appointment count synchronization if doctor changed
    if (doctorChanged && updateFields.doctor_id !== undefined) {
      const oldDoctorId = appointment.doctor_id;
      const newDoctorId = data.doctor_id;

      if (oldDoctorId) {
        await db.Doctors.decrement("appointment_count", {
          by: 1,
          where: { doctor_id: oldDoctorId, tenant_id },
          transaction,
        });
      }

      if (newDoctorId) {
        await db.Doctors.increment("appointment_count", {
          by: 1,
          where: { doctor_id: newDoctorId, tenant_id },
          transaction,
        });
      }
    }

    await transaction.commit();
    console.log(
      `[UPDATE-APPOINTMENT-SERVICE] Transaction committed successfully`,
    );

    const updatedAppointment = await db.Appointments.findOne({
      where: { appointment_id, tenant_id },
    });

    console.log(`[UPDATE-APPOINTMENT-SERVICE] Updated appointment:`, {
      id: updatedAppointment?.appointment_id,
      date: updatedAppointment?.appointment_date,
      time: updatedAppointment?.appointment_time,
    });

    // Build list of what changed for the email
    const emailChanges = [];
    if (data.appointment_date !== undefined)
      emailChanges.push(
        `Date changed to ${formatAppointmentDate(data.appointment_date)}`,
      );
    if (data.appointment_time !== undefined)
      emailChanges.push(`Time changed to ${data.appointment_time}`);
    if (data.doctor_id !== undefined) emailChanges.push("Doctor updated");
    if (data.patient_name !== undefined)
      emailChanges.push("Patient name updated");
    if (data.status !== undefined)
      emailChanges.push(`Status changed to ${data.status}`);

    // Determine email type based on what changed
    const emailType = data.status || "Updated";
    sendAppointmentNotificationEmail(
      tenant_id,
      appointment_id,
      emailType,
      emailChanges,
    ).catch(() => {});

    return updatedAppointment;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const deleteAppointmentService = async (tenant_id, appointment_id) => {
  try {
    const appointment = await db.Appointments.findOne({
      where: { appointment_id, tenant_id, is_deleted: false },
    });
    if (!appointment) {
      throw new Error("Appointment not found");
    }
    const transaction = await db.sequelize.transaction();
    try {
      await db.Appointments.update(
        { status: "Cancelled", is_deleted: true, deleted_at: new Date() },
        { where: { appointment_id, tenant_id }, transaction },
      );

      // Decrement doctor's appointment count ONLY if not already cancelled
      // (prevents double-decrement when dashboard cancels status but AI also cancels)
      if (appointment.doctor_id && appointment.status !== "Cancelled") {
        await db.Doctors.decrement("appointment_count", {
          by: 1,
          where: { doctor_id: appointment.doctor_id, tenant_id },
          transaction,
        });
      }

      await transaction.commit();

      // Send cancellation email notification (non-blocking)
      sendAppointmentNotificationEmail(
        tenant_id,
        appointment_id,
        "Cancelled",
      ).catch(() => {});

      return { message: "Appointment deleted successfully" };
    } catch (dbErr) {
      await transaction.rollback();
      throw dbErr;
    }
  } catch (err) {
    throw err;
  }
};

// ─── Get Available Slots for a Doctor on a Date ───
export const getAvailableSlotsService = async (tenant_id, doctor_id, date) => {
  try {
    const normalizedDate = normalizeDateOnly(date, "date");
    // 1. Verify doctor exists in database first
    const doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id, is_deleted: false },
      attributes: ["consultation_duration", "status"],
    });

    if (!doctor) {
      console.log(
        `[GET-AVAILABLE-SLOTS] Doctor ${doctor_id} not found in database`,
      );
      return {
        available: false,
        reason: "Doctor not found in our system",
        slots: [],
      };
    }

    if (doctor.status !== "available") {
      return {
        available: false,
        reason: "Doctor is currently unavailable",
        slots: [],
      };
    }

    // 2. Determine day_of_week from the date consistently with availability checks.
    const dayOfWeek = getDayOfWeekFromDate(normalizedDate);

    // 3. Get doctor's availability for that day
    const availabilitySlots = await db.DoctorAvailability.findAll({
      where: { doctor_id, tenant_id, day_of_week: dayOfWeek },
      order: [["start_time", "ASC"]],
    });

    if (!availabilitySlots || availabilitySlots.length === 0) {
      return {
        available: false,
        reason: "Doctor does not work on this day",
        slots: [],
      };
    }

    const fallbackDuration = doctor.consultation_duration || 30;

    // 4. Stored doctor_availability rows are concrete appointment slots.
    const allSlots = availabilitySlots.map((avail) => ({
      time: formatTimeToAMPM(avail.start_time),
      startMinutes: timeToMinutes(avail.start_time),
      endMinutes: timeToMinutes(avail.end_time),
      duration: getDurationFromAvailabilityRow(avail, fallbackDuration),
    })).filter((slot) => slot.endMinutes > slot.startMinutes && slot.endMinutes <= 1439);

    // 5. Get booked slots for that doctor on that date
    const bookedAppointments = await db.Appointments.findAll({
      where: {
        tenant_id,
        doctor_id,
        is_deleted: false,
        appointment_date: buildAppointmentDateWhere(normalizedDate),
        status: { [Op.in]: BOOKED_SLOT_STATUSES },
      },
      attributes: ["appointment_time"],
    });
    // 6. Filter out booked slots using range-based overlap logic
    const freeSlots = allSlots.filter((slot) => {
      const hasOverlap = bookedAppointments.some((appt) => {
        const apptStart = timeToMinutes(appt.appointment_time);
        const apptDuration = getDurationForAppointmentTime({
          availabilityRows: availabilitySlots,
          appointmentTime: appt.appointment_time,
          fallbackDuration,
        });
        const apptEnd = apptStart + apptDuration;
        return slot.startMinutes < apptEnd && slot.endMinutes > apptStart;
      });

      return !hasOverlap;
    }).map((slot) => slot.time);

    return {
      available: freeSlots.length > 0,
      day: dayOfWeek,
      slots: freeSlots,
      totalSlots: allSlots.length,
      bookedCount: bookedAppointments.length,
    };
  } catch (err) {
    throw err;
  }
};

// Placeholder for scheduler - will be refined in next steps
export const startAppointmentSchedulerService = () => {
  console.log("[APPOINTMENT-SCHEDULER] Initialized");
  // Implementation of Cron Job will be here
};
