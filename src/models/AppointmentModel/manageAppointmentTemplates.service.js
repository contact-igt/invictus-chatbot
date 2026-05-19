import {
  getAppointmentPhone,
  getAppointmentServiceName,
  getAppointmentTimeRange,
  getTenantBranchFallback,
} from "./manageAppointmentLookup.service.js";

const truncate = (value, max) => String(value || "").slice(0, max);
const MAX_LIST_ROWS = 10;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatListDate = (value) => {
  if (!value) return "-";

  const raw = String(value).trim();
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const monthIndex = Number(dateOnlyMatch[2]) - 1;
    return `${Number(dateOnlyMatch[3])} ${MONTH_LABELS[monthIndex] || dateOnlyMatch[2]}`;
  }

  const parsedDate = new Date(value);
  if (!Number.isNaN(parsedDate.getTime())) {
    return `${parsedDate.getDate()} ${MONTH_LABELS[parsedDate.getMonth()]}`;
  }

  return truncate(raw, 24);
};

const formatListTime = (value) => {
  if (!value) return "-";

  const raw = String(value).trim();
  const amPmMatch = raw.match(/^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?\s*([ap]\.?m\.?)$/i);
  if (amPmMatch) {
    const hour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2] || 0);
    const period = amPmMatch[3].replace(/\./g, "").toUpperCase();

    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
    }
  }

  const time24Match = raw.match(/^(\d{1,2})(?::(\d{1,2}))?(?::\d{1,2})?$/);
  if (time24Match) {
    const hour24 = Number(time24Match[1]);
    const minute = Number(time24Match[2] || 0);

    if (hour24 >= 0 && hour24 <= 23 && minute >= 0 && minute <= 59) {
      const period = hour24 >= 12 ? "PM" : "AM";
      const hour12 = hour24 % 12 || 12;
      return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
    }
  }

  return raw;
};

export const buildManageTextPayload = (to, text) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "text",
  text: {
    preview_url: false,
    body: truncate(text, 4096),
  },
});

export const buildManageButtonPayload = (to, text, buttons) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: truncate(text, 1024) },
    action: {
      buttons: buttons.slice(0, 3).map((button) => ({
        type: "reply",
        reply: {
          id: truncate(button.id, 256),
          title: truncate(button.title, 20),
        },
      })),
    },
  },
});

export const buildManageListPayload = (to, text, buttonLabel, sections) => {
  let count = 0;
  const safeSections = sections
    .map((section) => ({
      title: truncate(section.title, 24),
      rows: (section.rows || [])
        .filter(() => {
          if (count >= MAX_LIST_ROWS) return false;
          count += 1;
          return true;
        })
        .map((row) => ({
          id: truncate(row.id, 200),
          title: truncate(row.title, 24),
          description: truncate(row.description, 72),
        })),
    }))
    .filter((section) => section.rows.length);

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: truncate(text, 1024) },
      action: {
        button: truncate(buttonLabel, 20),
        sections: safeSections,
      },
    },
  };
};

export const buildNoManageAppointmentsPayload = (to) =>
  buildManageButtonPayload(
    to,
    "I couldn’t find any active booked appointments linked to this WhatsApp number.\n\nWould you like to book a new appointment?",
    [
      { id: "manage_appt_book_new", title: "Book Appointment" },
      { id: "manage_appt_main_menu", title: "Main Menu" },
    ],
  );

export const buildManageAppointmentActionsPayload = (to, detailsText) =>
  buildManageButtonPayload(to, detailsText, [
    { id: "manage_appt_edit", title: "Edit Appointment" },
    { id: "manage_appt_reschedule", title: "Re-schedule" },
    { id: "manage_appt_cancel", title: "Cancel Appointment" },
  ]);

export const formatManageAppointmentDetails = async ({ tenantId, appointment }) => {
  const timeRange = await getAppointmentTimeRange({ tenantId, appointment });
  const branchName = appointment.branch_name || (await getTenantBranchFallback(tenantId));
  const serviceName = getAppointmentServiceName(appointment);
  const doctorName = appointment.doctor?.name
    ? `${appointment.doctor?.title === "Dr" || !appointment.doctor?.title ? "Dr." : appointment.doctor.title} ${appointment.doctor.name}`
    : "-";

  return (
    `📌 Your Appointment Details\n\n` +
    `👤 Patient Name: ${appointment.patient_name || "-"}\n` +
    `📞 Phone: ${getAppointmentPhone(appointment)}\n` +
    `📧 Email: ${appointment.email || appointment.contact?.email || "-"}\n` +
    `🩺 Doctor: ${doctorName}\n` +
    `🏥 Service: ${serviceName}\n` +
    `📅 Date: ${String(appointment.appointment_date || "-").slice(0, 10)}\n` +
    `🕒 Time: ${timeRange.start} - ${timeRange.end}\n` +
    `📍 Branch: ${branchName || "-"}\n` +
    `📝 Reason: ${appointment.notes || "-"}\n` +
    `✅ Status: ${String(appointment.status || "-").toUpperCase()}`
  );
};

export const buildManageAppointmentDetailsPayload = async ({ tenantId, to, appointment }) =>
  buildManageAppointmentActionsPayload(
    to,
    await formatManageAppointmentDetails({ tenantId, appointment }),
  );

export const buildManageAppointmentSelectionPayload = ({ to, appointments, page = 0 }) => {
  const hasOverflow = appointments.length > MAX_LIST_ROWS;
  const pageSize = hasOverflow ? 8 : MAX_LIST_ROWS;
  const start = page * pageSize;
  const pageItems = appointments.slice(start, start + pageSize);
  const hasNext = hasOverflow && start + pageSize < appointments.length;
  const rows = pageItems.map((appointment) => {
    const dateLabel = formatListDate(appointment.appointment_date);
    const timeLabel = formatListTime(appointment.appointment_time);
    const patientLabel = appointment.patient_name || "Patient";

    return {
      id: `manage_appt_select_${appointment.appointment_id}`,
      title: `${dateLabel} ${timeLabel}`,
      description: `${patientLabel} | Dr. ${appointment.doctor?.name || "-"} | ${appointment.status || "-"}`,
    };
  });

  if (hasOverflow && hasNext) {
    rows.push({
      id: "manage_appt_next_page",
      title: "Next Appointments",
      description: "View more bookings",
    });
  }

  if (hasOverflow) {
    rows.push({
      id: "manage_appt_back_main",
      title: "Back to Main Menu",
      description: "Exit appointment management",
    });
  }

  return buildManageListPayload(
    to,
    "You have multiple booked appointments.\n\nPlease select the appointment you want to manage:",
    "Appointments",
    [{ title: "Booked appointments", rows }],
  );
};

export const buildManageEditMenuPayload = (to) =>
  buildManageListPayload(to, "What would you like to edit?", "Edit", [
    {
      title: "Appointment details",
      rows: [
        { id: "manage_appt_edit_name", title: "Patient Name", description: "Update patient name" },
        { id: "manage_appt_edit_phone", title: "Phone Number", description: "Update phone number" },
        { id: "manage_appt_edit_email", title: "Email", description: "Update email address" },
        { id: "manage_appt_edit_reason", title: "Reason for Visit", description: "Update visit reason" },
        { id: "manage_appt_back_details", title: "Back", description: "Return to details" },
      ],
    },
  ]);

export const buildManageDateListPayload = (to, dates) =>
  buildManageListPayload(to, "Please choose a new appointment date.", "Pick date", [
    {
      title: "Available dates",
      rows: dates.map((date) => ({
        id: `manage_appt_date_${date.value}`,
        title: date.label,
        description: date.description || "Available",
      })),
    },
  ]);

export const buildManageSlotListPayload = (to, rows, bodyText = "Please choose an available time slot.", sectionTitle = "Available Time Slots") =>
  buildManageListPayload(to, bodyText, "Pick time", [
    {
      title: sectionTitle,
      rows,
    },
  ]);

export const buildManageRescheduleConfirmPayload = ({ to, oldAppointment, newDate, newTime, newDoctorName }) => {
  const oldDoctorName = oldAppointment.doctor?.name ? `Dr. ${oldAppointment.doctor.name}` : "-";
  const nextDoctorName = newDoctorName ? `Dr. ${newDoctorName}` : oldDoctorName;
  const text =
    `Please confirm re-schedule:\n\n` +
    `Current Appointment:\n` +
    `📅 ${String(oldAppointment.appointment_date || "-").slice(0, 10)}\n` +
    `🕒 ${oldAppointment.appointment_time || "-"}\n` +
    `🩺 ${oldDoctorName}\n\n` +
    `New Appointment:\n` +
    `📅 ${newDate || "-"}\n` +
    `🕒 ${newTime || "-"}\n` +
    `🩺 ${nextDoctorName}\n\n` +
    `Do you want to confirm?`;

  return buildManageButtonPayload(to, text, [
    { id: "manage_appt_confirm_reschedule", title: "Confirm" },
    { id: "manage_appt_back_details", title: "Back" },
  ]);
};

export const buildManageCancelConfirmPayload = ({ to, appointment }) => {
  const doctorName = appointment.doctor?.name ? `Dr. ${appointment.doctor.name}` : "-";
  const text =
    `Are you sure you want to cancel this appointment?\n\n` +
    `👤 ${appointment.patient_name || "-"}\n` +
    `📅 ${String(appointment.appointment_date || "-").slice(0, 10)}\n` +
    `🕒 ${appointment.appointment_time || "-"}\n` +
    `🩺 ${doctorName}`;

  return buildManageButtonPayload(to, text, [
    { id: "manage_appt_confirm_cancel", title: "Yes, Cancel" },
    { id: "manage_appt_back_details", title: "No, Go Back" },
  ]);
};
