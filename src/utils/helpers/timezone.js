/**
 * Timezone utility functions for consistent date/time handling across the application.
 * Ensures AI and all time-related operations use the tenant's configured timezone.
 */

// Default timezone if none is configured
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

// List of supported timezones for validation
export const SUPPORTED_TIMEZONES = [
  "Asia/Kolkata", // India (IST)
  "America/New_York", // US Eastern
  "America/Chicago", // US Central
  "America/Denver", // US Mountain
  "America/Los_Angeles", // US Pacific
  "Europe/London", // UK
  "Europe/Paris", // Central Europe
  "Europe/Berlin", // Germany
  "Asia/Dubai", // UAE
  "Asia/Singapore", // Singapore
  "Asia/Tokyo", // Japan
  "Asia/Hong_Kong", // Hong Kong
  "Asia/Shanghai", // China
  "Australia/Sydney", // Australia Eastern
  "Australia/Perth", // Australia Western
  "Pacific/Auckland", // New Zealand
  "UTC", // Universal
];

/**
 * Get the current date/time in the specified timezone
 * @param {string} timezone - IANA timezone string (e.g., "Asia/Kolkata")
 * @returns {Date} - Date object adjusted to timezone
 */
export const getDateInTimezone = (timezone = DEFAULT_TIMEZONE) => {
  const tz = SUPPORTED_TIMEZONES.includes(timezone)
    ? timezone
    : DEFAULT_TIMEZONE;
  return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
};

/**
 * Get formatted current date for AI prompts
 * @param {string} timezone - IANA timezone string
 * @returns {Object} - { date, day, time, timezone, dateISO }
 */
export const getCurrentDateTimeForAI = (timezone = DEFAULT_TIMEZONE) => {
  const tz = SUPPORTED_TIMEZONES.includes(timezone)
    ? timezone
    : DEFAULT_TIMEZONE;
  const now = getDateInTimezone(tz);

  // Get timezone display name
  const tzDisplay =
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value || tz;

  return {
    date: now.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    day: now.toLocaleDateString("en-US", { weekday: "long" }),
    time: now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    timezone: tz,
    timezoneDisplay: tzDisplay,
    dateISO: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    // For calendar calculations
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    dayOfMonth: now.getDate(),
    dayOfWeek: now.getDay(), // 0 = Sunday
  };
};

/**
 * Convert a date string to a specific timezone
 * @param {string|Date} dateInput - Date to convert
 * @param {string} timezone - Target timezone
 * @returns {Object} - Formatted date parts
 */
export const convertToTimezone = (dateInput, timezone = DEFAULT_TIMEZONE) => {
  const tz = SUPPORTED_TIMEZONES.includes(timezone)
    ? timezone
    : DEFAULT_TIMEZONE;
  const date = new Date(dateInput);

  return {
    date: date.toLocaleDateString("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "long",
      year: "numeric",
    }),
    day: date.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" }),
    time: date.toLocaleTimeString("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }),
    dateISO: date.toLocaleDateString("en-CA", { timeZone: tz }), // YYYY-MM-DD format
  };
};

/**
 * Calculate what day of the week a specific date falls on
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {string} timezone - Timezone for calculation
 * @returns {string} - Day name (e.g., "Monday")
 */
export const getDayOfWeek = (dateStr, timezone = DEFAULT_TIMEZONE) => {
  const tz = SUPPORTED_TIMEZONES.includes(timezone)
    ? timezone
    : DEFAULT_TIMEZONE;
  const date = new Date(dateStr + "T12:00:00"); // Use noon to avoid edge cases
  return date.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" });
};

/**
 * Get calendar reference for AI (e.g., April 2026 calendar)
 * Helps AI correctly calculate "next tuesday", "first monday of month", etc.
 * @param {number} year - Year
 * @param {number} month - Month (1-12)
 * @returns {Object} - Calendar data with days mapped to dates
 */
export const getMonthCalendar = (year, month) => {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const daysInMonth = lastDay.getDate();

  const calendar = {
    year,
    month,
    monthName: firstDay.toLocaleDateString("en-US", { month: "long" }),
    daysInMonth,
    firstDayOfWeek: firstDay.toLocaleDateString("en-US", { weekday: "long" }),
    days: {},
  };

  // Map each day
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  for (let i = 0; i < 7; i++) {
    calendar.days[dayNames[i]] = [];
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dayName = dayNames[date.getDay()];
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    calendar.days[dayName].push({ date: d, dateISO: dateStr });
  }

  return calendar;
};

/**
 * Generate calendar text for AI prompt to help with date calculations
 * @param {string} timezone - Timezone for calculations
 * @returns {string} - Human-readable calendar reference
 */
export const getCalendarReferenceForAI = (timezone = DEFAULT_TIMEZONE) => {
  const now = getCurrentDateTimeForAI(timezone);
  const currentMonth = getMonthCalendar(now.year, now.month);
  const nextMonth = getMonthCalendar(
    now.month === 12 ? now.year + 1 : now.year,
    now.month === 12 ? 1 : now.month + 1,
  );

  const formatDays = (calendar) => {
    const lines = [];
    for (const [dayName, dates] of Object.entries(calendar.days)) {
      if (dates.length > 0) {
        const dateNums = dates.map((d) => d.date).join(", ");
        lines.push(`  ${dayName}: ${dateNums}`);
      }
    }
    return lines.join("\n");
  };

  return `
CALENDAR REFERENCE (for accurate date calculations):
Today: ${now.day}, ${now.date} (${now.timezoneDisplay})

${currentMonth.monthName} ${currentMonth.year}:
${formatDays(currentMonth)}

${nextMonth.monthName} ${nextMonth.year}:
${formatDays(nextMonth)}

EXAMPLES:
- "next Tuesday" from ${now.day}, ${now.dayOfMonth} ${currentMonth.monthName} → check next occurance of Tuesday
- "first Monday of next month" → look at ${nextMonth.monthName}'s Monday dates, pick the first one
`;
};
