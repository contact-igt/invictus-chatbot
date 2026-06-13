import db from "../../database/index.js";

// ── Low-level helpers ─────────────────────────────────────────────────────────

// "09:30 AM" / "09:30 PM" → "09:30" / "21:30"
const amPmTo24h = (timeStr) => {
  if (!timeStr) return "00:00";
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return timeStr; // already 24h or plain HH:mm
  let [, h, m, period] = match;
  let hour = parseInt(h, 10);
  if (period.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (period.toUpperCase() === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${m}`;
};

// Any date value → "YYYY-MM-DD" string (safe against Date objects from Sequelize DATEONLY)
const normalizeDateStr = (d) => {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

// Subtract N calendar days from "YYYY-MM-DD" → "YYYY-MM-DD" using local date arithmetic
const subtractDays = (dateStr, days) => {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, mo - 1, d);
  dt.setDate(dt.getDate() - days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

// ── Per-rule scheduled_at calculation ─────────────────────────────────────────

/**
 * Returns a Date (IST) for when a reminder should fire, given the appointment.
 *
 * rule_type = "fixed_day_time":
 *   scheduled_at = (appointment_date - days_before) at send_time IST
 *
 * rule_type = "relative_before":
 *   scheduled_at = appointment_datetime - (hours_before * 60 + minutes_before) minutes
 *
 * legacy (no rule_type, offset_minutes present):
 *   scheduled_at = appointment_datetime + offset_minutes
 */
const computeScheduledAtFromRule = (rule, dateStr, time24h) => {
  if (rule.rule_type === "fixed_day_time") {
    const daysBefore = Number(rule.days_before) || 0;
    const targetDate = subtractDays(dateStr, daysBefore);
    // Defensive slice(0,5): MySQL TIME columns return "HH:MM:SS"; VARCHAR(5) returns "HH:MM"
    const sendTime = (rule.send_time || "09:00").slice(0, 5);
    const dt = new Date(`${targetDate}T${sendTime}:00+05:30`);
    if (isNaN(dt.getTime())) {
      throw new Error(
        `fixed_day_time: invalid computed datetime date="${targetDate}" send_time="${sendTime}"`,
      );
    }
    return dt;
  }

  if (rule.rule_type === "relative_before") {
    const apptAt = new Date(`${dateStr}T${time24h}:00+05:30`);
    if (isNaN(apptAt.getTime())) {
      throw new Error(
        `relative_before: invalid appointment datetime date="${dateStr}" time="${time24h}"`,
      );
    }
    const totalMinutes =
      (Number(rule.hours_before) || 0) * 60 +
      (Number(rule.minutes_before) || 0);
    apptAt.setMinutes(apptAt.getMinutes() - totalMinutes);
    return apptAt;
  }

  // Legacy fallback — offset_minutes (negative = before appointment)
  const apptAt = new Date(`${dateStr}T${time24h}:00+05:30`);
  if (isNaN(apptAt.getTime())) {
    throw new Error(
      `legacy offset_minutes: invalid appointment datetime date="${dateStr}" time="${time24h}"`,
    );
  }
  apptAt.setMinutes(apptAt.getMinutes() + (Number(rule.offset_minutes) || 0));
  return apptAt;
};

// Human-readable description of a rule for log messages
const ruleDesc = (rule) => {
  if (rule.rule_type === "fixed_day_time") {
    return `fixed_day_time(days_before=${rule.days_before}, send_time=${rule.send_time})`;
  }
  if (rule.rule_type === "relative_before") {
    return `relative_before(hours=${rule.hours_before || 0}, minutes=${rule.minutes_before || 0})`;
  }
  return `legacy(offset_minutes=${rule.offset_minutes})`;
};

// ── Admin rules payload validator (exported — called in controller) ───────────

export const validateReminderRulesPayload = (rules) => {
  if (!Array.isArray(rules)) {
    throw new Error("rules must be an array.");
  }

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    const n = i + 1;

    if (!r.rule_name || !String(r.rule_name).trim()) {
      throw new Error(`Rule ${n}: rule_name is required.`);
    }
    if (!r.template_id || !String(r.template_id).trim()) {
      throw new Error(`Rule ${n}: template_id is required.`);
    }

    if (r.rule_type === "fixed_day_time") {
      if (r.days_before === undefined || r.days_before === null) {
        throw new Error(
          `Rule ${n}: days_before is required for fixed_day_time.`,
        );
      }
      if (Number(r.days_before) < 0) {
        throw new Error(
          `Rule ${n}: days_before must be >= 0 (got ${r.days_before}).`,
        );
      }
      if (!r.send_time) {
        throw new Error(`Rule ${n}: send_time is required for fixed_day_time.`);
      }
      if (!/^\d{2}:\d{2}$/.test(r.send_time)) {
        throw new Error(
          `Rule ${n}: send_time must be HH:mm format (got "${r.send_time}").`,
        );
      }
    } else if (r.rule_type === "relative_before") {
      const h = Number(r.hours_before) || 0;
      const m = Number(r.minutes_before) || 0;
      if (h < 0 || m < 0) {
        throw new Error(
          `Rule ${n}: hours_before and minutes_before must be >= 0.`,
        );
      }
      if (h * 60 + m <= 0) {
        throw new Error(
          `Rule ${n}: total offset must be > 0 for relative_before (got hours=${h}, minutes=${m}).`,
        );
      }
    } else if (!r.rule_type) {
      // Legacy: must have offset_minutes
      if (r.offset_minutes === undefined || r.offset_minutes === null) {
        throw new Error(
          `Rule ${n}: either rule_type ('fixed_day_time' or 'relative_before') or offset_minutes is required.`,
        );
      }
    } else {
      throw new Error(
        `Rule ${n}: invalid rule_type "${r.rule_type}". Allowed: 'fixed_day_time', 'relative_before'.`,
      );
    }

    if (
      r.sort_order !== undefined &&
      (isNaN(Number(r.sort_order)) || Number(r.sort_order) < 0)
    ) {
      throw new Error(`Rule ${n}: sort_order must be a non-negative integer.`);
    }
  }
};

// ── Custom reminder validator (called sync in createAppointmentService) ────────

export const validateCustomRemindersForAppointment = (
  customReminders,
  appointmentDate,
  appointmentTime,
) => {
  if (!Array.isArray(customReminders)) {
    throw new Error("custom_reminders must be an array.");
  }
  if (customReminders.length === 0) {
    throw new Error(
      "At least one custom reminder is required when reminder_mode is 'custom'.",
    );
  }
  if (customReminders.length > 5) {
    throw new Error("Maximum 5 custom reminders are allowed per appointment.");
  }

  const now = new Date();
  const apptDateStr = normalizeDateStr(appointmentDate);
  const apptTime24h = amPmTo24h(appointmentTime);
  const appointmentAt = new Date(`${apptDateStr}T${apptTime24h}:00+05:30`);

  if (isNaN(appointmentAt.getTime())) {
    throw new Error(
      "Cannot validate reminders: appointment date/time is invalid.",
    );
  }

  const seenTimes = new Set();

  for (let i = 0; i < customReminders.length; i++) {
    const r = customReminders[i];
    const n = i + 1;

    if (!r.template_id || !String(r.template_id).trim()) {
      throw new Error(`Reminder ${n}: template_id is required.`);
    }
    if (!r.scheduled_date) {
      throw new Error(`Reminder ${n}: scheduled_date is required.`);
    }
    if (!r.scheduled_time) {
      throw new Error(`Reminder ${n}: scheduled_time is required.`);
    }

    const scheduledAt = new Date(
      `${r.scheduled_date}T${r.scheduled_time}:00+05:30`,
    );
    if (isNaN(scheduledAt.getTime())) {
      throw new Error(
        `Reminder ${n}: invalid date/time "${r.scheduled_date} ${r.scheduled_time}".`,
      );
    }
    if (scheduledAt <= now) {
      throw new Error(
        `Reminder ${n}: scheduled time must be in the future (got ${r.scheduled_date} ${r.scheduled_time}).`,
      );
    }
    if (scheduledAt >= appointmentAt) {
      throw new Error(
        `Reminder ${n}: must be scheduled before the appointment (${apptDateStr} ${appointmentTime}).`,
      );
    }

    const key = scheduledAt.toISOString();
    if (seenTimes.has(key)) {
      throw new Error(
        `Reminder ${n}: duplicate scheduled time "${r.scheduled_date} ${r.scheduled_time}".`,
      );
    }
    seenTimes.add(key);
  }
};

// ── Reminder scheduler ────────────────────────────────────────────────────────

export const scheduleAppointmentRemindersService = async ({
  tenant_id,
  appointment_id,
  appointment_date,
  appointment_time,
  contact_id,
  country_code,
  contact_number,
  reminder_mode = "default",
  custom_reminders = [],
  transaction = null, // optional transaction for atomic operations
}) => {
  if (reminder_mode === "none") {
    await db.ScheduledMessages.destroy({
      where: {
        tenant_id,
        appointment_id,
        send_type: "appointment_reminder",
        status: "pending",
      },
      transaction,
    });
    return { scheduled: 0, skipped: true, reason: "reminder_mode_none" };
  }

  const rawCode = (country_code || "91").toString().replace(/^\+/, "");
  const rawNumber = (contact_number || "").toString().replace(/\D/g, "");
  const toPhone = `${rawCode}${rawNumber}`;

  if (!tenant_id || !appointment_id || !contact_id || !rawNumber) {
    throw new Error("Cannot schedule reminders: missing appointment contact details.");
  }

  const dateStr = normalizeDateStr(appointment_date);
  const time24h = amPmTo24h(appointment_time);
  const now = new Date();

  await db.ScheduledMessages.destroy({
    where: {
      tenant_id,
      appointment_id,
      send_type: "appointment_reminder",
      status: "pending",
    },
    transaction,
  });

  let rows = [];

  if (reminder_mode === "custom") {
    validateCustomRemindersForAppointment(
      custom_reminders,
      appointment_date,
      appointment_time,
    );

    rows = custom_reminders.map((reminder) => ({
      tenant_id,
      contact_id,
      appointment_id,
      template_id: reminder.template_id,
      to_phone: toPhone,
      header_media_url: reminder.header_media_url || null,
      header_file_name: reminder.header_file_name || null,
      send_type: "appointment_reminder",
      scheduled_at: new Date(
        `${reminder.scheduled_date}T${reminder.scheduled_time}:00+05:30`,
      ),
      status: "pending",
    }));
  } else {
    const rules = await db.AppointmentReminderRules.findAll({
      where: { tenant_id, is_active: true },
      order: [
        ["sort_order", "ASC"],
        ["id", "ASC"],
      ],
      transaction,
    });

    rows = rules
      .map((rule) => {
        const scheduledAt = computeScheduledAtFromRule(rule, dateStr, time24h);
        return {
          tenant_id,
          contact_id,
          appointment_id,
          template_id: rule.template_id,
          to_phone: toPhone,
          header_media_url: rule.header_media_url || null,
          header_file_name: rule.header_file_name || null,
          send_type: "appointment_reminder",
          scheduled_at: scheduledAt,
          status: "pending",
          _ruleDesc: ruleDesc(rule),
        };
      })
      .filter((row) => {
        if (row.scheduled_at <= now) {
          console.warn(
            `[REMINDER] Skipping past reminder for appointment=${appointment_id}: ${row._ruleDesc}`,
          );
          return false;
        }
        return true;
      })
      .map(({ _ruleDesc, ...row }) => row);
  }

  if (!rows.length) {
    return { scheduled: 0, skipped: true, reason: "no_future_reminders" };
  }

  await db.ScheduledMessages.bulkCreate(rows, { transaction });
  return { scheduled: rows.length, skipped: false };
};

export const getReminderRulesService = async (tenant_id) => {
  return db.AppointmentReminderRules.findAll({
    where: { tenant_id },
    order: [
      ["sort_order", "ASC"],
      ["id", "ASC"],
    ],
  });
};

export const upsertReminderRulesService = async (tenant_id, rules) => {
  validateReminderRulesPayload(rules);

  return db.sequelize.transaction(async (transaction) => {
    await db.AppointmentReminderRules.destroy({
      where: { tenant_id },
      transaction,
    });

    if (!rules.length) {
      return [];
    }

    const payload = rules.map((rule, index) => ({
      tenant_id,
      rule_name: String(rule.rule_name).trim(),
      rule_type: rule.rule_type || null,
      days_before:
        rule.days_before === undefined || rule.days_before === null
          ? null
          : Number(rule.days_before),
      send_time: rule.send_time || null,
      hours_before:
        rule.hours_before === undefined || rule.hours_before === null
          ? null
          : Number(rule.hours_before),
      minutes_before:
        rule.minutes_before === undefined || rule.minutes_before === null
          ? null
          : Number(rule.minutes_before),
      offset_minutes:
        rule.offset_minutes === undefined || rule.offset_minutes === null
          ? null
          : Number(rule.offset_minutes),
      template_id: String(rule.template_id).trim(),
      header_media_url: rule.header_media_url || null,
      header_file_name: rule.header_file_name || null,
      sort_order:
        rule.sort_order === undefined || rule.sort_order === null
          ? index
          : Number(rule.sort_order),
      is_active:
        rule.is_active === undefined || rule.is_active === null
          ? true
          : Boolean(rule.is_active),
    }));

    return db.AppointmentReminderRules.bulkCreate(payload, {
      transaction,
      returning: true,
    });
  });
};
