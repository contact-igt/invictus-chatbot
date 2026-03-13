import db from "../../database/index.js";
import { Op, fn, col, where as seqWhere } from "sequelize";
import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { formatTimeToAMPM } from "../../utils/helpers/formatTime.js";
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
    return `${displayHour}:${m} ${period.toUpperCase()}`;
  }
  // Otherwise convert from 24h format
  return formatTimeToAMPM(time);
};

export const createAppointmentService = async (data) => {
  let {
    tenant_id,
    contact_id,
    doctor_id,
    patient_name,
    contact_number,
    appointment_date,
    status = "Pending",
    notes,
  } = data;

  let { appointment_time } = data;

  // Normalize contact_number: strip +, ensure digits only
  if (contact_number) {
    contact_number = formatPhoneNumber(contact_number);
  }

  // Validate country code is present
  if (contact_number && contact_number.length <= 10) {
    throw new Error(
      "Country code is required. Phone number must include country code (e.g. 919876543210)",
    );
  }

  // Normalize time to consistent format (e.g. "09:00 AM" not "9:00 AM")
  appointment_time = normalizeTimeFormat(appointment_time);

  if (!appointment_time) {
    throw new Error("Appointment time is required.");
  }

  if (!appointment_date) {
    throw new Error("Appointment date is required.");
  }

  if (!patient_name) {
    throw new Error("Patient name is required.");
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
      );
      contact_id = newContact.contact_id;
    }
  }

  if (!contact_id) {
    throw new Error(
      "Contact not found and could not be created. Please provide a valid contact number.",
    );
  }

  // Use a transaction to prevent race conditions on duplicate/slot checks
  const transaction = await db.sequelize.transaction();

  try {
    // 1. Check for duplicate booking (same patient, same doctor, same date+time)
    const existingPatient = await db.Appointments.findOne({
      where: {
        tenant_id,
        contact_id,
        is_deleted: false,
        [Op.and]: [
          seqWhere(fn("DATE", col("appointment_date")), appointment_date),
        ],
        appointment_time,
        status: { [Op.not]: "Cancelled" },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingPatient) {
      throw new Error("You already have an appointment booked for this time.");
    }

    // 2. Check for doctor slot conflict (prevent two patients booking the same doctor at same time)
    if (doctor_id) {
      const doctorSlotConflict = await db.Appointments.findOne({
        where: {
          tenant_id,
          doctor_id,
          is_deleted: false,
          [Op.and]: [
            seqWhere(fn("DATE", col("appointment_date")), appointment_date),
          ],
          appointment_time,
          status: { [Op.in]: ["Pending", "Confirmed"] },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (doctorSlotConflict) {
        throw new Error(
          "This time slot is already booked for the selected doctor. Please choose another time.",
        );
      }
    }

    // 3. Generate Unique Appointment ID and Token Number (inside transaction for consistency)
    const appointment_id = await generateReadableIdFromLast(
      tableNames.APPOINTMENTS,
      "appointment_id",
      "AP",
    );

    const count = await db.Appointments.count({
      where: {
        tenant_id,
        doctor_id,
        [Op.and]: [
          seqWhere(fn("DATE", col("appointment_date")), appointment_date),
        ],
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
        patient_name,
        contact_number,
        appointment_date,
        appointment_time,
        status,
        token_number,
        notes: notes || null,
      },
      { transaction },
    );

    await transaction.commit();

    // 4. Send Confirmation Email (Async, outside transaction)
    if (data.email) {
      console.log(`[APPOINTMENT] Sending confirmation email to ${data.email}`);
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
        status: { [Op.in]: ["Pending", "Confirmed"] },
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

export const getAppointmentsByContactIdService = async (
  tenant_id,
  contact_id,
) => {
  try {
    return await db.Appointments.findAll({
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

export const getAllAppointmentsService = async (
  tenant_id,
  { search, status, date } = {},
) => {
  try {
    const where = { tenant_id, is_deleted: false };
    if (status) where.status = status;
    if (date) where.appointment_date = date;

    const appointments = await db.Appointments.findAll({
      where,
      include: [
        {
          model: db.Doctors,
          as: "doctor",
          attributes: ["doctor_id", "name", "title"],
        },
      ],
      order: [
        ["appointment_date", "DESC"],
        ["appointment_time", "ASC"],
      ],
    });

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      return appointments.filter(
        (a) =>
          (a.patient_name || "").toLowerCase().includes(q) ||
          (a.contact_number || "").includes(q),
      );
    }

    return appointments;
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
) => {
  try {
    if (!doctor_id || !date || !time) {
      throw new Error(
        "doctor_id, date, and time are required for availability check.",
      );
    }

    const formattedTime = normalizeTimeFormat(time);

    const existing = await db.Appointments.findOne({
      where: {
        tenant_id,
        doctor_id,
        is_deleted: false,
        [Op.and]: [seqWhere(fn("DATE", col("appointment_date")), date)],
        appointment_time: formattedTime,
        status: { [Op.in]: ["Pending", "Confirmed"] },
      },
    });
    return !existing;
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

    const emailTo = appointment.contact?.email;
    if (!emailTo) return;

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
) => {
  try {
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
  const transaction = await db.sequelize.transaction();

  try {
    const appointment = await db.Appointments.findOne({
      where: { appointment_id, tenant_id, is_deleted: false },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!appointment) {
      throw new Error("Appointment not found");
    }

    const updateFields = {};
    if (data.patient_name !== undefined)
      updateFields.patient_name = data.patient_name;
    if (data.appointment_date !== undefined)
      updateFields.appointment_date = data.appointment_date;
    if (data.status !== undefined) updateFields.status = data.status;
    if (data.doctor_id !== undefined) updateFields.doctor_id = data.doctor_id;
    if (data.notes !== undefined) updateFields.notes = data.notes;

    if (data.appointment_time !== undefined) {
      updateFields.appointment_time = normalizeTimeFormat(
        data.appointment_time,
      );
    }

    if (data.contact_number !== undefined) {
      let contact_number = formatPhoneNumber(data.contact_number);
      if (contact_number && contact_number.length <= 10) {
        throw new Error(
          "Country code is required. Phone number must include country code (e.g. 919876543210)",
        );
      }
      updateFields.contact_number = contact_number;
    }

    // Check for doctor slot conflict if date, time, or doctor is being changed
    const newDate =
      updateFields.appointment_date || appointment.appointment_date;
    const newTime =
      updateFields.appointment_time || appointment.appointment_time;
    const newDoctorId = updateFields.doctor_id || appointment.doctor_id;
    const dateChanged = data.appointment_date !== undefined;
    const timeChanged = data.appointment_time !== undefined;
    const doctorChanged = data.doctor_id !== undefined;

    if ((dateChanged || timeChanged || doctorChanged) && newDoctorId) {
      // Format date for comparison
      // Timezone-safe: avoid toISOString() which shifts to UTC
      let checkDate;
      if (typeof newDate === "string") {
        checkDate = newDate;
      } else if (newDate instanceof Date) {
        checkDate = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, "0")}-${String(newDate.getDate()).padStart(2, "0")}`;
      } else {
        checkDate = newDate;
      }

      const slotConflict = await db.Appointments.findOne({
        where: {
          tenant_id,
          doctor_id: newDoctorId,
          is_deleted: false,
          id: { [Op.ne]: appointment.id }, // Exclude the current appointment
          [Op.and]: [seqWhere(fn("DATE", col("appointment_date")), checkDate)],
          appointment_time: newTime,
          status: { [Op.in]: ["Pending", "Confirmed"] },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (slotConflict) {
        throw new Error(
          "This time slot is already booked for the selected doctor. Please choose another time.",
        );
      }
    }

    await db.Appointments.update(updateFields, {
      where: { appointment_id, tenant_id },
      transaction,
    });

    await transaction.commit();

    const updatedAppointment = await db.Appointments.findOne({
      where: { appointment_id, tenant_id },
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
    await db.Appointments.update(
      { is_deleted: true, deleted_at: new Date() },
      { where: { appointment_id, tenant_id } },
    );
    return { message: "Appointment deleted successfully" };
  } catch (err) {
    throw err;
  }
};

// ─── Get Available Slots for a Doctor on a Date ───
export const getAvailableSlotsService = async (tenant_id, doctor_id, date) => {
  try {
    // 1. Determine day_of_week from the date
    const dateObj = new Date(date + "T00:00:00");
    const days = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const dayOfWeek = days[dateObj.getDay()];

    // 2. Get doctor's availability for that day
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

    // 3. Get doctor's consultation_duration
    const doctor = await db.Doctors.findOne({
      where: { doctor_id, tenant_id, is_deleted: false },
      attributes: ["consultation_duration"],
    });
    const slotDuration = doctor?.consultation_duration || 30;

    // 4. Generate all possible time slots
    const allSlots = [];
    for (const avail of availabilitySlots) {
      const [startH, startM] = avail.start_time.split(":").map(Number);
      const [endH, endM] = avail.end_time.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      for (
        let m = startMinutes;
        m + slotDuration <= endMinutes;
        m += slotDuration
      ) {
        const hours = Math.floor(m / 60);
        const mins = m % 60;
        const period = hours >= 12 ? "PM" : "AM";
        const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        const timeStr = `${String(displayHour).padStart(2, "0")}:${String(mins).padStart(2, "0")} ${period}`;
        allSlots.push(timeStr);
      }
    }

    // 5. Get booked slots for that doctor on that date
    const bookedAppointments = await db.Appointments.findAll({
      where: {
        tenant_id,
        doctor_id,
        is_deleted: false,
        [Op.and]: [seqWhere(fn("DATE", col("appointment_date")), date)],
        status: { [Op.in]: ["Pending", "Confirmed"] },
      },
      attributes: ["appointment_time"],
    });
    const bookedTimes = new Set(
      bookedAppointments.map((a) => a.appointment_time),
    );

    // 6. Filter out booked slots
    const freeSlots = allSlots.filter((slot) => !bookedTimes.has(slot));

    return {
      available: freeSlots.length > 0,
      day: dayOfWeek,
      slots: freeSlots,
      totalSlots: allSlots.length,
      bookedCount: bookedTimes.size,
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
