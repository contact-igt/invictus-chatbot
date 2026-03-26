/**
 * Sanitizes a phone number string by removing all non-digits.
 * The number MUST already include a country code prefix (e.g. 919876543210).
 * If a 10-digit number is given, 91 is prepended as default (India).
 *
 * @param {string} phone - The raw phone number string.
 * @returns {string|null} - The formatted phone number (digits only, with country code) or null if invalid.
 */
export const formatPhoneNumber = (phone) => {
  if (!phone) return null;

  // Remove all non-digit characters (including +)
  let cleaned = phone.toString().replace(/\D/g, "");

  if (!cleaned) return null;

  // If it's a 10-digit number, prepend 91 (default India)
  if (cleaned.length === 10) {
    return `91${cleaned}`;
  }

  // If it starts with 0 and then has 10 digits, remove 0 and prepend 91
  if (cleaned.length === 11 && cleaned.startsWith("0")) {
    return `91${cleaned.slice(1)}`;
  }

  // Number with country code should be > 10 digits and max 15 digits (E.164 standard)
  if (cleaned.length > 10 && cleaned.length <= 15) {
    return cleaned;
  }

  // Less than 10 digits or more than 15 digits — invalid
  return null;
};

/**
 * Validates that a phone number includes a country code.
 * Must be more than 10 digits (country code + subscriber number).
 *
 * @param {string} phone - The phone number (digits only, no +).
 * @returns {boolean}
 */
export const hasCountryCode = (phone) => {
  if (!phone) return false;
  const cleaned = phone.toString().replace(/\D/g, "");
  return cleaned.length > 10 && cleaned.length <= 15;
};
