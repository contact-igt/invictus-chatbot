import db from "../../database/index.js";
import {
  scheduleAppointmentRemindersService,
  validateCustomRemindersForAppointment,
} from "./appointmentReminder.service.js";
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
import { sendWhatsAppTemplate } from "../AuthWhatsapp/AuthWhatsapp.service.js";
import { renderTemplateContent } from "../../utils/whatsapp/templateRenderer.js";
import {
  createLiveChatService,
  getLivechatByIdService,
  updateLiveChatTimestampService,
} from "../LiveChatModel/livechat.service.js";
import { getTenantSettingsService } from "../TenantModel/tenant.service.js";
import { getIO } from "../../middlewares/socket/socket.js";

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
  
  }

  return components;
};

const inferFollowUpTemplateMediaMeta = (components = []) => {
  const headerComp = Array.isArray(components)
    ? components.find((c) => c?.type === "header")
    : null;
  const headerParam = headerComp?.parameters?.[0] || null;

  let messageType = "template";
  let mediaUrl = null;
  let mediaFilename = null;
  let mediaMimeType = null;

  if (headerParam?.image?.link) {
    messageType = "image";
    mediaUrl = headerParam.image.link;
  } else if (headerParam?.video?.link) {
    messageType = "video";
    mediaUrl = headerParam.video.link;
  } else if (headerParam?.document?.link) {
    messageType = "document";
    mediaUrl = headerParam.document.link;
    mediaFilename = headerParam.document.filename || null;
    if (mediaFilename) {
      const ext = mediaFilename.split(".").pop()?.toLowerCase();
      const mimeMap = {
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      mediaMimeType = mimeMap[ext] || "application/octet-stream";
    }
  } else if (headerParam?.location) {
    messageType = "location";
  }

  return { messageType, mediaUrl, mediaFilename, mediaMimeType };
};

export const persistFollowUpSentMessageService = async ({
  tenant_id,
  scheduledMessage,
  template,
  components = [],
  meta_message_id,
  phone_number_id = null,
}) => {
  if (!meta_message_id) return { created: false, reason: "missing_wamid" };

  const existing = await db.Messages.findOne({
    where: { wamid: meta_message_id },
    attributes: ["id"],
    raw: true,
  });
  if (existing?.id) {
    return { created: false, duplicate: true, id: existing.id };
  }

  const contact = await db.Contacts.findOne({
    where: {
      tenant_id,
      contact_id: scheduledMessage.contact_id,
      is_deleted: false,
    },
    attributes: ["name"],
    raw: true,
  });

  const messageContent = await renderTemplateContent(
    scheduledMessage.template_id,
    components,
  );
  const { messageType, mediaUrl, mediaFilename, mediaMimeType } =
    inferFollowUpTemplateMediaMeta(components);

  const { createUserMessageService } =
    await import("../Messages/messages.service.js");
  const savedMsg = await createUserMessageService(
    tenant_id,
    scheduledMessage.contact_id,
    phone_number_id,
    scheduledMessage.to_phone,
    meta_message_id,
    contact?.name || scheduledMessage.to_phone,
    "admin",
    null,
    messageContent,
    messageType,
    mediaUrl,
    mediaMimeType,
    "sent",
    template?.template_name || null,
    mediaFilename,
  );

  if (!savedMsg?.id) {
    return { created: false, duplicate: true, id: null };
  }

  const livechat = await getLivechatByIdService(
    tenant_id,
    scheduledMessage.contact_id,
  );
  if (!livechat) {
    await createLiveChatService(tenant_id, scheduledMessage.contact_id);
  } else {
    await updateLiveChatTimestampService(
      tenant_id,
      scheduledMessage.contact_id,
    );
  }

  try {
    const io = getIO();
    io.to(`tenant-${tenant_id}`).emit("new-message", {
      tenant_id,
      phone: scheduledMessage.to_phone,
      id: savedMsg?.id,
      contact_id: scheduledMessage.contact_id,
      name: contact?.name || scheduledMessage.to_phone,
      message: messageContent,
      sender: "admin",
      message_type: messageType,
      media_url: mediaUrl,
      media_filename: mediaFilename,
      status: "sent",
      created_at: new Date(),
    });
  } catch (socketErr) {
    console.error(
      "[FOLLOWUP-PERSIST] Socket emit failed:",
      socketErr?.message || socketErr,
    );
  }

  return { created: true, id: savedMsg?.id || null };
};

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

const normalizeDurationValue = (value, min, max) => {
  const duration = Number(value);
  if (!Number.isInteger(duration)) return null;
  if (duration < min || duration > max) return null;
  return duration;
};

const getDoctorDefaultConsultationDuration = (doctor) => {
  const duration = normalizeDurationValue(doctor?.consultation_duration, 5, 240);
  return duration ?? 30;
};

const getDoctorDaySlotDurationOverride = async ({
  tenant_id,
  doctor_id,
  date,
  transaction = null,
}) => {
  const day_of_week = getDayOfWeekFromDate(date);
  const dayConfig = await db.DoctorAvailabilityDays.findOne({
    where: {
      tenant_id,
      doctor_id,
      day_of_week,
    },
    attributes: ["slot_duration", "use_default_duration", "enabled"],
    transaction,
  });

  if (!dayConfig || dayConfig.enabled === false) return null;
  if (dayConfig.use_default_duration === true) return null;

  return normalizeDurationValue(dayConfig.slot_duration, 5, 480);
};

const getDurationFromAvailabilityRow = (
  row,
  fallbackDuration = 30,
  daySlotDurationOverride = null,
) => {
  if (!row) return fallbackDuration;
  const override = normalizeDurationValue(daySlotDurationOverride, 5, 480);
  if (override !== null) return override;
  return fallbackDuration;
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
  daySlotDurationOverride = null,
}) => {
  const row = findAvailabilityRowForTime(availabilityRows, appointmentTime);
  return getDurationFromAvailabilityRow(
    row,
    fallbackDuration,
    daySlotDurationOverride,
  );
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

  // Validate custom reminders synchronously — must throw before the transaction opens.
  // Always validate when mode=custom so empty-array case also surfaces an error.
  if (data.reminder_mode === "custom") {
    validateCustomRemindersForAppointment(
      data.custom_reminders || [],
      appointment_date,
      appointment_time,
    );
  }

  if (isAppointmentsDebugEnabled) {
    
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

    const fallbackDuration = getDoctorDefaultConsultationDuration(doctor);
    const daySlotDurationOverride = await getDoctorDaySlotDurationOverride({
      tenant_id,
      doctor_id,
      date: appointment_date,
    });
    doctorDuration = getDurationFromAvailabilityRow(
      selectedAvailability,
      fallbackDuration,
      daySlotDurationOverride,
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

    scheduleAppointmentRemindersService({
      tenant_id,
      appointment_id: appointment.appointment_id,
      appointment_date,
      appointment_time,
      contact_id: appointment.contact_id,
      country_code,
      contact_number,
      reminder_mode: data.reminder_mode || "default",
      custom_reminders: data.custom_reminders || [],
    }).catch((err) =>
      console.error("[REMINDER] Schedule failed:", err.message),
    );

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
            status: {
              [Op.in]: ["Pending", "Confirmed", "Rescheduled", "Completed"],
            },
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
  follow_up_time = null,
  follow_up_type = null,
  follow_up_reason = null,
  template_id = null,
  header_media_url = null,
  header_file_name = null,
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
    const safeFollowUpTime = requiresFollowUp
      ? follow_up_time || "09:00"
      : null;
    const safeFollowUpType = requiresFollowUp ? follow_up_type || null : null;
    const safeFollowUpReason = requiresFollowUp
      ? follow_up_reason || null
      : null;
    const safeTemplateId = requiresFollowUp ? template_id || null : null;

    if (requiresFollowUp && !safeFollowUpDate) {
      throw new Error("Follow-up date is required when follow-up is enabled.");
    }
    if (requiresFollowUp && !safeFollowUpType) {
      throw new Error("Follow-up type is required when follow-up is enabled.");
    }
    if (safeFollowUpType && !ALLOWED_FOLLOW_UP_TYPES.has(safeFollowUpType)) {
      throw new Error("Invalid follow-up type.");
    }
    if (requiresFollowUp && !safeFollowUpReason) {
      throw new Error(
        "Follow-up reason is required when follow-up is enabled.",
      );
    }
    if (
      requiresFollowUp &&
      safeFollowUpType === "WhatsApp" &&
      !safeTemplateId
    ) {
      throw new Error(
        "WhatsApp template is required when follow-up type is WhatsApp.",
      );
    }

    let resolvedHeaderMediaUrl = null;
    let resolvedHeaderFileName = null;
    if (requiresFollowUp && safeFollowUpType === "WhatsApp" && safeTemplateId) {
      const headerMeta = await getTemplateHeaderMetaService(
        tenant_id,
        safeTemplateId,
        transaction,
      );
      const headerMedia = resolveFollowUpHeaderMediaForTemplate({
        headerMeta,
        header_media_url,
        header_file_name,
      });
      resolvedHeaderMediaUrl = headerMedia.header_media_url;
      resolvedHeaderFileName = headerMedia.header_file_name;
    }

    const existingOutcome = await db.AppointmentOutcomes.findOne({
      where: { appointment_id, tenant_id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const outcomeFields = {
      notes: normalizedNotes,
      follow_up_required: requiresFollowUp,
      follow_up_date: safeFollowUpDate,
      follow_up_time: safeFollowUpTime,
      follow_up_type: safeFollowUpType,
      follow_up_reason: safeFollowUpReason,
      template_id: safeTemplateId,
    };

    if (existingOutcome) {
      await existingOutcome.update(outcomeFields, { transaction });
    } else {
      await db.AppointmentOutcomes.create(
        { appointment_id, tenant_id, ...outcomeFields },
        { transaction },
      );
    }

    await appointment.update({ status: "Completed" }, { transaction });

    {
      const cancelled = await db.ScheduledMessages.destroy({
        where: {
          tenant_id,
          appointment_id,
          send_type: "appointment_reminder",
          status: "pending",
        },
        transaction,
      });
      if (cancelled > 0) {
        