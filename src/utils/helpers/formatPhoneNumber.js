/**
 * Sanitizes a phone number string by removing all non-digits,
 * and ensures it has a '91' prefix.
 * 
 * @param {string} phone - The raw phone number string.
 * @returns {string|null} - The formatted phone number or null if invalid.
 */
export const formatPhoneNumber = (phone) => {
    if (!phone) return null;

    // Remove all non-digit characters (including +)
    let cleaned = phone.toString().replace(/\D/g, "");

    // If it's a 10-digit number, prepend 91
    if (cleaned.length === 10) {
        return `91${cleaned}`;
    }

    // If it starts with 0 and then has 10 digits, remove 0 and prepend 91
    if (cleaned.length === 11 && cleaned.startsWith("0")) {
        return `91${cleaned.slice(1)}`;
    }

    // If it's already 12 digits starting with 91, return it
    if (cleaned.length === 12 && cleaned.startsWith("91")) {
        return cleaned;
    }

    // Fallback: return the cleaned digits (might be international or partial)
    // For this project, we primarily focus on 91 prefix
    return cleaned;
};
