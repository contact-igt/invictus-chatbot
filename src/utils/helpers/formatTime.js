/**
 * Converts 24-hour time string (HH:mm) to 12-hour format with AM/PM (hh:mm A)
 * @param {string} time24 - Time in 24-hour format (e.g., "14:30", "09:00", "22:15:00")
 * @returns {string} - Time in 12-hour format (e.g., "02:30 PM", "09:00 AM", "10:15 PM")
 */
export const formatTimeToAMPM = (time24) => {
    if (!time24) return "";

    // Handle string inputs like "HH:mm" or "HH:mm:ss"
    const [hours, minutes] = time24.split(":");
    let h = parseInt(hours, 10);
    const m = minutes;

    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    h = h ? h : 12; // the hour '0' should be '12'

    // Ensure 2-digit hour if desired, or keep it simple. Usually "10:30 AM" or "02:30 PM".
    const hDisplay = h < 10 ? `0${h}` : h;

    return `${hDisplay}:${m} ${ampm}`;
};

/**
 * Converts a time string (HH:mm or hh:mm A) to minutes from midnight
 * @param {string} timeStr - Time string
 * @returns {number} - Minutes from midnight
 */
export const timeToMinutes = (timeStr) => {
    if (!timeStr) return 0;

    let hours, minutes, ampm;

    if (timeStr.includes("AM") || timeStr.includes("PM")) {
        // 12-hour format: "10:30 AM"
        const [time, part] = timeStr.split(" ");
        const [h, m] = time.split(":");
        hours = parseInt(h, 10);
        minutes = parseInt(m, 10);
        ampm = part;

        if (ampm === "PM" && hours !== 12) hours += 12;
        if (ampm === "AM" && hours === 12) hours = 0;
    } else {
        // 24-hour format: "14:30" or "09:00:00"
        const parts = timeStr.split(":");
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
    }

    return hours * 60 + minutes;
};

/**
 * Checks if a time is within a range
 * @param {string} checkTime - Time to check
 * @param {string} startTime - Start of range
 * @param {string} endTime - End of range
 * @returns {boolean}
 */
export const isTimeInRange = (checkTime, startTime, endTime) => {
    const check = timeToMinutes(checkTime);
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);

    return check >= start && check <= end;
};

