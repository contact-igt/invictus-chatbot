import db from "../../database/index.js";
import { Op } from "sequelize";
import { formatTimeToAMPM, timeToMinutes } from "../../utils/helpers/formatTime.js";

export const MANAGE_ACTIVE_APPOINTMENT_STATUSES = [
  "Pending",
  "Confirmed",
  "Rescheduled",
];

export const MANAGE_HIDDEN_APPOINTMENT_STATUSES = [
  "Cancelled",
  "Completed",
  "Expired",
  "Noshow",
];

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export const normalizeManagePhone = (phone = "") => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};

export const getPhoneSuffix = (phone = "") => {
  const normalized = normalizeManagePhone(phone);
  return normalized ? normalized.slice(-10) : null;
};

export const splitNormalizedPhone = (phone = "") => {
  const normalized = normalizeManagePhone(phone);
  if (!normalized || normalized.length < 10) return null;
  const local = normalized.slice(-10);
  const country = normalized.slice(0, -10) || "91";
  return { normalized, country_code: `+${country}`, contact_number: local };
};

const todayDateOnly = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const getDayOfWeek = (dateStr) => {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  return DAY_NAMES[d.getDay()];
};

const minutesToAmPm = (minutes) => {
  const normalized = Math.max(0, Math.min(1439, Number(minutes) || 0));
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return formatTimeToAMPM(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
};

const getDurationFromAvailabilityRow = (row, fallbackDuration = 30) => {
  if (!row) return fallbackDuration;
  const start = timeToMinutes(row.start_time);
  const end = timeToMinutes(row.end_time);
  return end > start ? end - start : fallbackDuration;
};

const appointmentInclude = [
  {
    model: db.Doctors,
    as: "doctor",
    required: false,
    attributes: ["doctor_id", "name", "title", "qualification", "consultation_duration"],
    include: [
      {
        model: db.Specializations,
        as: "specializations",
        required: false,
        attributes: ["specialization_id", "name"],
        through: { attributes: [] },
      },
    ],
  },
  {
    model: db.Contacts,
    as: "contact",
    required: false,
    attributes: ["contact_id", "country_code", "phone", "name", "email"],
  },
];

export const findContactIdsForPhone = async ({ tenantId, userPhone }) => {
  const suffix = getPhoneSuffix(userPhone);
  if (!suffix) return [];
  const contacts = await db.Contacts.findAll({
    where: {
      tenant_id: tenantId,
      is_deleted: false,
      phone: { [Op.like]: `%${suffix}` },
    },
    attributes: ["contact_id"],
    raw: true,
  });
  return contacts.map((row) => row.contact_id).filter(Boolean);
};

export const getManageAppointmentsForUser = async ({ tenantId, userPhone }) => {
  const suffix = getPhoneSuffix(userPhone);
  if (!suffix) return [];
  const contactIds = await findContactIdsForPhone({ tenantId, userPhone });
  const or = [{ contact_number: { [Op.like]: `%${suffix}` } }];
  if (contactIds.length) or.push({ contact_id: { [Op.in]: contactIds } });

  const appointments = await db.Appointments.findAll({
    where: {
      tenant_id: tenantId,
      is_deleted: false,
      status: { [Op.in]: MANAGE_ACTIVE_APPOINTMENT_STATUSES },
      appointment_date: { [Op.gte]: todayDateOnly() },
      [Op.or]: or,
    },
    include: appointmentInclude,
  });

  return appointments.sort((a, b) => {
    const dateA = String(a.appointment_date || "").slice(0, 10);
    const dateB = String(b.appointment_date || "").slice(0, 10);
    if (dateA !== dateB) return dateA.localeCompare(dateB);
    return timeToMinutes(a.appointment_time) - timeToMinutes(b.appointment_time);
  });
};

export const getManageAppointmentById = async ({ tenantId, appointmentId }) => {
  if (!appointmentId) return null;
  return db.Appointments.findOne({
    where: {
      tenant_id: tenantId,
      appointment_id: appointmentId,
      is_deleted: false,
    },
    include: appointmentInclude,
  });
};

export const getTenantBranchFallback = async (tenantId) => {
  const tenant = await db.Tenants.findOne({
    where: { tenant_id: tenantId, is_deleted: false },
    attributes: ["company_name", "address", "city", "state"],
    raw: true,
  });
  if (!tenant) return "-";
  const location = [tenant.city, tenant.state].filter(Boolean).join(", ");
  return tenant.company_name || location || tenant.address || "-";
};

export const getDoctorAvailabilityForAppointment = async ({ tenantId, appointment }) => {
  if (!appointment?.doctor_id || !appointment?.appointment_date) return null;
  const day = getDayOfWeek(appointment.appointment_date);
  const rows = await db.DoctorAvailability.findAll({
    where: {
      tenant_id: tenantId,
      doctor_id: appointment.doctor_id,
      day_of_week: day,
    },
    order: [["start_time", "ASC"]],
  });
  const apptStart = timeToMinutes(appointment.appointment_time);
  return (
    rows.find((row) => timeToMinutes(row.start_time) === apptStart) ||
    rows.find((row) => {
      const start = timeToMinutes(row.start_time);
      const end = timeToMinutes(row.end_time);
      return apptStart >= start && apptStart < end;
    }) ||
    null
  );
};

export const getAppointmentTimeRange = async ({ tenantId, appointment }) => {
  const start = appointment?.appointment_time || "-";
  if (!appointment?.appointment_time) return { start, end: "-" };
  const availability = await getDoctorAvailabilityForAppointment({ tenantId, appointment });
  const fallbackDuration = appointment?.doctor?.consultation_duration || 30;
  const duration = getDurationFromAvailabilityRow(availability, fallbackDuration);
  const end = minutesToAmPm(timeToMinutes(start) + duration);
  return { start, end };
};

export const getAppointmentServiceName = (appointment) => {
  if (appointment?.service_name) return appointment.service_name;
  const specializations = appointment?.doctor?.specializations || [];
  const names = specializations.map((item) => item.name).filter(Boolean);
  if (names.length) return names.join(", ");
  return appointment?.notes || "-";
};

export const getAppointmentPhone = (appointment) => {
  const cc = appointment?.country_code || appointment?.contact?.country_code || "+91";
  const local = appointment?.contact_number || appointment?.contact?.phone || "";
  if (!local) return "-";
  return `${cc}${local}`;
};

export const userCanAccessManageAppointment = ({ appointment, userPhone, session = null }) => {
  if (!appointment) return false;
  if (!MANAGE_ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status)) return false;
  if (appointment.is_deleted) return false;

  const suffix = getPhoneSuffix(userPhone);
  if (!suffix) return false;

  let appointmentIds = [];
  if (Array.isArray(session?.appointment_ids)) {
    appointmentIds = session.appointment_ids;
  } else if (typeof session?.appointment_ids === "string") {
    try {
      appointmentIds = JSON.parse(session.appointment_ids || "[]");
    } catch {
      appointmentIds = [];
    }
  }
  if (appointmentIds.includes(appointment.appointment_id)) return true;

  const appointmentPhone = String(appointment.contact_number || "").replace(/\D/g, "");
  const contactPhone = String(appointment.contact?.phone || "").replace(/\D/g, "");
  return appointmentPhone.endsWith(suffix) || contactPhone.endsWith(suffix);
};
