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

  // New rule: accept either a local 10-digit number or a country-code-prefixed 12-digit number.
  // - If 10 digits are provided, normalize by prepending default country code '91' and return 12-digit string.
  // - If 11 digits starting with 0 (leading trunk), drop the 0 and treat result as 10 digits (then prepend '91').
  // - If 12 digits are provided (already include country code), accept as-is.
  // Any other lengths are considered invalid for this project's stricter validation.

  if (cleaned.length === 10) {
    return `91${cleaned}`; // normalize to 12-digit (default country code)
  }

  if (cleaned.length === 11 && cleaned.startsWith("0")) {
    // e.g. 0XXXXXXXXXX -> strip leading 0 and treat as local 10-digit
    return `91${cleaned.slice(1)}`;
  }

  if (cleaned.length === 12) {
    return cleaned; // already country-code + local number (12 digits)
  }

  // Anything else is invalid under the stricter 10/12 digit rule
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
  // Under the stricter rule, country-code-included numbers are 12 digits.
  return cleaned.length === 12;
};
