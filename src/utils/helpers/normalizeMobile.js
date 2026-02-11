/**
 * Cleans a mobile number by removing non-digits and stripping the country code prefix
 * if it's already provided in a separate field.
 * 
 * @param {string} countryCode - The country code (e.g., "91", "+91")
 * @param {string} rawMobile - The raw mobile number provided by the user
 * @returns {string} - The cleaned subscriber number
 */
export const normalizeMobile = (countryCode, rawMobile) => {
    if (!rawMobile) return "";

    // Remove all non-digit characters
    const cleanedMobile = rawMobile.toString().replace(/\D/g, "");
    const cleanedCC = countryCode ? countryCode.toString().replace(/\D/g, "") : "";

    // If mobile starts with the country code, strip it
    if (cleanedCC && cleanedMobile.startsWith(cleanedCC)) {
        return cleanedMobile.slice(cleanedCC.length);
    }

    // Otherwise return cleaned mobile
    return cleanedMobile;
};
