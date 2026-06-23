export const DAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_SET = new Set(DAY_ORDER);
const DEFAULT_SLOT_DURATION = 15;

export const time24ToMinutes = (time) => {
  const match = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export const minutesToTime24 = (minutes) => {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1439) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const normalizeSlotDuration = (value, day) => {
  const duration = Number(value ?? DEFAULT_SLOT_DURATION);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    throw new Error(`Slot duration for ${day} must be an integer between 5 and 480 minutes.`);
  }
  return duration;
};

const normalizeDayName = (value) => String(value || "").trim().toLowerCase();

const getRawSlots = (item) => {
  if (Array.isArray(item?.slots)) return item.slots;
  if (item?.start_time || item?.end_time) {
    return [{ start_time: item.start_time, end_time: item.end_time }];
  }
  return [];
};

export const normalizeAvailabilityForPersistence = (availability = []) => {
  if (!Array.isArray(availability)) {
    throw new Error("Availability must be an array.");
  }

  const daysByName = new Map();

  for (const item of availability) {
    const day = normalizeDayName(item?.day_of_week || item?.day);
    if (!DAY_SET.has(day)) {
      throw new Error(`Invalid availability day: ${item?.day || item?.day_of_week || "unknown"}.`);
    }

    const rawSlots = getRawSlots(item);
    const enabled = Boolean(item?.enabled ?? rawSlots.length > 0);
    const rawDuration = item?.slotDuration ?? item?.slot_duration;
    const explicitUseDefault =
      item?.useDefaultDuration ?? item?.use_default_duration;
    const hasCustomDuration =
      rawDuration !== undefined &&
      rawDuration !== null &&
      String(rawDuration).trim() !== "";
    const useDefaultDuration =
      explicitUseDefault !== undefined
        ? Boolean(explicitUseDefault)
        : !hasCustomDuration;
    const slotDuration = useDefaultDuration
      ? null
      : normalizeSlotDuration(rawDuration, day);

    const slots = rawSlots
      .map((slot) => ({
        start_time: String(slot?.start_time || "").trim(),
        end_time: String(slot?.end_time || "").trim(),
      }))
      .filter((slot) => slot.start_time || slot.end_time);

    if (enabled && slots.length === 0) {
      throw new Error(`At least one slot is required for enabled day ${day}.`);
    }

    const normalizedSlots = slots.map((slot) => {
      const start = time24ToMinutes(slot.start_time);
      const end = time24ToMinutes(slot.end_time);
      if (start === null || end === null || start > 1439) {
        throw new Error(`Invalid time format for ${day}. Use HH:mm.`);
      } else if (end > 1439) {
        throw new Error(`End time cannot exceed 23:59 for ${day}.`);
      } else if (end <= start) {
        throw new Error(`End time must be after start time for ${day}.`);
      }
      return { ...slot, startMinutes: start, endMinutes: end };
    });

    normalizedSlots.sort((a, b) => a.startMinutes - b.startMinutes);

    for (let index = 1; index < normalizedSlots.length; index += 1) {
      if (normalizedSlots[index].startMinutes < normalizedSlots[index - 1].endMinutes) {
        throw new Error(`Availability slots overlap for ${day}.`);
      }
    }

    daysByName.set(day, {
      day,
      enabled,
      useDefaultDuration,
      slotDuration,
      slots: enabled
        ? normalizedSlots.map(({ start_time, end_time }) => ({ start_time, end_time }))
        : [],
    });
  }

  return DAY_ORDER
    .filter((day) => daysByName.has(day))
    .map((day) => daysByName.get(day));
};

export const slotDurationFromRange = (startTime, endTime, fallback = DEFAULT_SLOT_DURATION) => {
  const start = time24ToMinutes(startTime);
  const end = time24ToMinutes(endTime);
  if (start === null || end === null || end <= start) return fallback;
  return end - start;
};
