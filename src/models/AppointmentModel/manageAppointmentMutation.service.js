import db from "../../database/index.js";
import { Op } from "sequelize";
import { callAI } from "../../utils/ai/coreAi.js";
import { getDomainSummary } from "../../utils/ai/domainContextHelper.js";
import { formatTimeToAMPM, timeToMinutes } from "../../utils/helpers/formatTime.js";
import {
  checkAvailabilityService,
  getAvailableSlotsService,
  updateAppointmentService,
} from "./appointment.service.js";
import {
  decodeSlotTime,
  encodeSlotTime,
} from "./appointmentReplyDecoder.js";
import {
  lockAppointmentSlot,
  markSlotBooked,
  releaseLockedSlots,
} from "./appointmentSlotLock.service.js";
import {
  getManageAppointmentById,
  splitNormalizedPhone,
} from "./manageAppointmentLookup.service.js";

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const SMALL_TALK_PATTERN = /^(hi|hy|hello|hey|thanks|thank you|ok|okay|how are you|good morning|good afternoon|good evening)$/i;
const QUESTION_PATTERN = /\b(what|when|where|which|who|why|how)\b|\?/i;
const ABUSE_PATTERN = /\b(fuck|shit|idiot|stupid|bastard|asshole)\b/i;

const toDateOnly = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const getDayOfWeek = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  return DAY_NAMES[d.getDay()];
};

const isPastDate = (dateStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return target < today;
};

const parseJsonObject = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
};

export const validateManageName = (value = "") => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < 2) return { valid: false, reason: "Name must be at least 2 characters." };
  if (/^\d+$/.test(text)) return { valid: false, reason: "Name cannot contain only numbers." };
  if (SMALL_TALK_PATTERN.test(text)) return { valid: false, reason: "Please send the patient name." };
  if (QUESTION_PATTERN.test(text)) return { valid: false, reason: "Please send only the patient name." };
  return { valid: true, value: text };
};

export const validateManageEmail = (value = "") => {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, reason: "Please send a valid email address." };
  }
  return { valid: true, value: email };
};

export const validateManagePhone = (value = "") => {
  const split = splitNormalizedPhone(value);
  if (!split || split.contact_number.length !== 10) {
    return { valid: false, reason: "Please send a valid 10-digit phone number." };
  }
  return { valid: true, value: split };
};

export const validateManageReasonBasic = (value = "") => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length < 2) return { valid: false, reason: "Please send the reason for visit." };
  if (SMALL_TALK_PATTERN.test(text)) return { valid: false, reason: "Please send the reason for visit." };
  if (ABUSE_PATTERN.test(text)) return { valid: false, reason: "Please send a valid reason for visit." };
  if (/^\d+$/.test(text)) return { valid: false, reason: "Reason cannot contain only numbers." };
  return { valid: true, value: text };
};

export const validateManageReasonWithAI = async ({ tenantId, reason }) => {
  const basic = validateManageReasonBasic(reason);
  if (!basic.valid) return basic;

  try {
    const domainSummary = await getDomainSummary(tenantId);
    const prompt = `You validate an appointment reason for this tenant's business.

BUSINESS CONTEXT:
${domainSummary || "No summary available"}

USER REASON:
"${basic.value}"

Return JSON only: {"valid": boolean, "reason": "short reason"}.
Valid means it is a genuine medical/business visit reason related to the tenant.
Reject greetings, jokes, abuse, random text, unrelated questions, and non-business topics.`;

    const result = await callAI({
      messages: [{ role: "system", content: prompt }],
      tenant_id: tenantId,
      source: "manage_appointment_reason_validation",
      temperature: 0,
      responseFormat: { type: "json_object" },
    });
    const parsed = parseJsonObject(result.content);
    if (parsed?.valid === false) {
      return { valid: false, reason: parsed.reason || "Please send a relevant reason for visit." };
    }
  } catch (err) {
    console.error("[MANAGE-APPT] Reason AI validation failed:", err.message);
  }

  return { valid: true, value: basic.value };
};

const getDoctorWithAvailability = async ({ tenantId, doctorId }) => {
  if (!doctorId) return null;
  return db.Doctors.findOne({
    where: { tenant_id: tenantId, doctor_id: doctorId, is_deleted: false, status: "available" },
    include: [
      {
        model: db.DoctorAvailability,
        as: "availability",
        required: false,
      },
    ],
  });
};

const getAvailableSlotsWithLocks = async ({ tenantId, doctorId, date, session, excludeAppointmentId = null }) => {
  const result = await getAvailableSlotsService(tenantId, doctorId, date);
  const baseSlots = (result?.slots || [])
    .map((slot) => ({ time: String(slot?.time || slot || "").trim() }))
    .filter((slot) => slot.time);

  const lockedRows = await db.AppointmentSlots.findAll({
    where: {
      tenant_id: tenantId,
      doctor_id: doctorId,
      appointment_date: date,
      status: { [Op.in]: ["LOCKED", "BOOKED"] },
      [Op.or]: [
        { status: "BOOKED" },
        { locked_by_session_id: session.session_id },
        { locked_until: { [Op.gt]: new Date() } },
      ],
    },
    attributes: ["appointment_time", "status", "locked_by_session_id", "appointment_id"],
  });

  const blocked = new Set(
    lockedRows
      .filter((row) => {
        if (row.locked_by_session_id === session.session_id) return false;
        if (excludeAppointmentId && row.appointment_id === excludeAppointmentId) return false;
        return true;
      })
      .map((row) => row.appointment_time),
  );

  return baseSlots.filter((slot) => !blocked.has(slot.time));
};

const isDateAvailable = async ({ tenantId, doctor, date, session, excludeAppointmentId }) => {
  if (!doctor || isPastDate(date)) return false;
  const day = getDayOfWeek(date);
  const worksThatDay = (doctor.availability || []).some((row) => row.day_of_week === day);
  if (!worksThatDay) return false;
  const slots = await getAvailableSlotsWithLocks({
    tenantId,
    doctorId: doctor.doctor_id,
    date,
    session,
    excludeAppointmentId,
  });
  return slots.length > 0;
};

export const getManageAvailableDates = async ({ tenantId, appointment, session }) => {
  const doctor = await getDoctorWithAvailability({ tenantId, doctorId: appointment.doctor_id });
  const dates = [];
  const cursor = new Date();

  for (let offset = 1; offset <= 14 && dates.length < 7; offset += 1) {
    const d = new Date(cursor);
    d.setDate(cursor.getDate() + offset);
    const value = toDateOnly(d);
    const ok = await isDateAvailable({
      tenantId,
      doctor,
      date: value,
      session,
      excludeAppointmentId: appointment.appointment_id,
    });
    if (!ok) continue;
    dates.push({
      value,
      label: d.toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      description: d.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
    });
  }
  return dates;
};

const getSlotGroupCount = (count) => {
  if (count <= 10) return 0;
  if (count <= 20) return 2;
  if (count <= 30) return 3;
  return 4;
};

const manageSlotId = (time) => `manage_appt_slot_${encodeSlotTime(time)}`;

export const buildManageSlotSelection = (slots = []) => {
  const availableSlots = slots.map((slot) => ({
    id: manageSlotId(slot.time || slot),
    time: slot.time || slot,
  }));
  const groupCount = getSlotGroupCount(availableSlots.length);
  const groupedSlots = [];
  if (groupCount > 0) {
    const groupSize = Math.ceil(availableSlots.length / groupCount);
    for (let i = 0; i < groupCount; i += 1) {
      const groupSlots = availableSlots.slice(i * groupSize, (i + 1) * groupSize);
      if (!groupSlots.length) continue;
      groupedSlots.push({
        id: `manage_appt_slot_group_${groupedSlots.length + 1}`,
        title: `${groupSlots[0].time}-${groupSlots[groupSlots.length - 1].time}`,
        slots: groupSlots,
      });
    }
  }
  return { availableSlots, groupedSlots, selectedGroupId: null };
};

export const getManageSlotRows = (slotSelection, selectedGroupId = null) => {
  if (selectedGroupId) {
    const group = (slotSelection?.groupedSlots || []).find((item) => item.id === selectedGroupId);
    return {
      rows: (group?.slots || []).map((slot) => ({ id: slot.id, title: slot.time, description: "Available" })),
      bodyText: "Please choose an available time slot.",
      sectionTitle: "Available Time Slots",
    };
  }

  if ((slotSelection?.groupedSlots || []).length) {
    return {
      rows: slotSelection.groupedSlots.map((group) => ({
        id: group.id,
        title: group.title,
        description: "View slots",
      })),
      bodyText: "Please choose a time range.",
      sectionTitle: "Available Time Ranges",
    };
  }

  return {
    rows: (slotSelection?.availableSlots || []).map((slot) => ({
      id: slot.id,
      title: slot.time,
      description: "Available",
    })),
    bodyText: "Please choose an available time slot.",
    sectionTitle: "Available Time Slots",
  };
};

export const resolveManageSlotReply = (replyId, slotSelection) => {
  const id = String(replyId || "").trim();
  if (!id) return null;
  if (id.startsWith("manage_appt_slot_group_")) {
    const group = (slotSelection?.groupedSlots || []).find((item) => item.id === id);
    return group ? { type: "group", group } : null;
  }
  if (!id.startsWith("manage_appt_slot_")) return null;
  const decoded = decodeSlotTime(id.slice("manage_appt_slot_".length));
  if (!decoded) return null;
  const allSlots = [
    ...(slotSelection?.availableSlots || []),
    ...((slotSelection?.groupedSlots || []).flatMap((group) => group.slots || [])),
  ];
  const matched = allSlots.find((slot) => slot.id === id || slot.time === decoded);
  return matched ? { type: "slot", slot: matched } : null;
};

export const getManageAvailableSlotSelection = async ({ tenantId, appointment, session, date }) => {
  const slots = await getAvailableSlotsWithLocks({
    tenantId,
    doctorId: appointment.doctor_id,
    date,
    session,
    excludeAppointmentId: appointment.appointment_id,
  });
  return buildManageSlotSelection(slots);
};

export const lockManageRescheduleSlot = async ({ tenantId, session, appointment, date, time }) => {
  const available = await checkAvailabilityService(
    tenantId,
    appointment.doctor_id,
    date,
    time,
    appointment.appointment_id,
  );
  if (!available) throw new Error("This slot is no longer available.");

  await releaseLockedSlots(session.session_id);
  const slot = await lockAppointmentSlot({
    tenantId,
    session,
    doctorId: appointment.doctor_id,
    date,
    time,
  });
  return slot;
};

export const updateManageAppointmentField = async ({ tenantId, appointment, field, value }) => {
  const payload = {};
  if (field === "name") payload.patient_name = value;
  if (field === "phone") {
    payload.country_code = value.country_code;
    payload.contact_number = value.contact_number;
  }
  if (field === "email") payload.email = value;
  if (field === "reason") {
    payload.notes = value;
    payload.service_name = value;
  }
  return updateAppointmentService(tenantId, appointment.appointment_id, payload);
};

export const releaseBookedSlotForAppointment = async ({ tenantId, appointmentId }) => {
  await db.AppointmentSlots.update(
    {
      status: "EXPIRED",
      locked_by_session_id: null,
      locked_until: null,
      appointment_id: null,
      updatedAt: new Date(),
    },
    {
      where: {
        tenant_id: tenantId,
        appointment_id: appointmentId,
        status: { [Op.in]: ["BOOKED", "LOCKED"] },
      },
    },
  );
};

export const confirmManageReschedule = async ({ tenantId, session, appointment }) => {
  const date = session.selected_date;
  const time = session.selected_time;
  if (!date || !time) throw new Error("Please select a new date and time first.");

  const updated = await updateAppointmentService(tenantId, appointment.appointment_id, {
    appointment_date: date,
    appointment_time: time,
    doctor_id: appointment.doctor_id,
    status: "Rescheduled",
  });

  await releaseBookedSlotForAppointment({ tenantId, appointmentId: appointment.appointment_id });
  const slot = await markSlotBooked({
    tenantId,
    session,
    doctorId: appointment.doctor_id,
    date,
    time,
    appointmentId: appointment.appointment_id,
  });

  await db.Appointments.update(
    { slot_id: slot?.id ? String(slot.id) : session.selected_slot_id || null },
    { where: { tenant_id: tenantId, appointment_id: appointment.appointment_id } },
  );

  return getManageAppointmentById({ tenantId, appointmentId: updated.appointment_id });
};

export const cancelManageAppointment = async ({ tenantId, appointment, userPhone }) => {
  const updated = await updateAppointmentService(tenantId, appointment.appointment_id, {
    status: "Cancelled",
    cancelled_at: new Date(),
    cancelled_by: userPhone,
  });
  await releaseBookedSlotForAppointment({ tenantId, appointmentId: appointment.appointment_id });
  return updated;
};

export const minutesToManageAmPm = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return formatTimeToAMPM(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
};
