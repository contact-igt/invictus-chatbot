/**
 * Meta WhatsApp API Error Classifier
 * Classifies errors by numeric error code instead of substring matching
 * Reference: Meta WhatsApp API error codes
 */

// Meta error codes that are RETRYABLE (transient, may succeed on retry)
// NOTE: Auth errors (190, 200) are NOT here — they are handled by isMetaAuthConfigError
// which pauses campaigns immediately rather than retrying uselessly.
const RETRYABLE_META_CODES = new Set([
  1005, // Limit exceeded (rate limiting)
  131056, // Try later (temporary service issue)
  100, // Unknown error (generic, can retry)
]);

// Meta error codes that are PERMANENT (will never succeed, don't retry)
const PERMANENT_META_CODES = new Set([
  131030, // Test recipient / invalid test number (never deliver)
  131031, // Invalid recipient phone (malformed number)
  131026, // Recipient has opted out (will never accept)
  131027, // Phone number is blocked (will never deliver)
  131028, // User unable to receive (account issue)
  131070, // Account not available (account suspended)
  131062, // Message template not found (config issue)
  131061, // Recipient not on WhatsApp (wrong number)
  131060, // Message rejected (invalid format)
  131059, // Campaign suspended (admin action)
  131058, // Rate limit exceeded for phone (permanent block)
  400, // Bad request (validation error, malformed data)
  403, // Forbidden (missing permissions)
  404, // Not found (resource doesn't exist)
  500, // Internal server error (usually transient but often treated as permanent)
  803, // Call to the API timed out (retryable under normal circumstances)
]);

// Network/system error codes that are RETRYABLE
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ESOCKETTIMEDOUT",
  "ERR_NETWORK",
  "EACCES",
  "ENOENT",
  "EMFILE",
  "ENFILE",
]);

// Fallback patterns for string-based error detection when code is unavailable
const PERMANENT_ERROR_PATTERNS = [
  "healthy ecosystem",
  "not delivered",
  "spam",
  "blocked",
  "recipient not on whatsapp",
  "incapable of receiving",
  "re-engage",
  "invalid phone",
  "variable mismatch",
  "missing media",
  "no valid url",
  "test recipient",
  "invalid test",
  "opted out",
];

/**
 * Extract Meta error code from various possible error object structures
 * @param {Error|Object} err - Error object from Meta API, axios, or system
 * @returns {number|null} Error code if found, null otherwise
 */
function extractMetaErrorCode(err) {
  if (!err) return null;

  // Try various paths where Meta error codes appear
  const codeValue =
    err?.meta_error_code ||
    err?.error?.code ||
    err?.response?.data?.error?.code ||
    err?.response?.data?.code ||
    err?.meta_response_status ||
    err?.status ||
    err?.response?.status ||
    err?.code ||
    err?.statusCode;

  const numCode = Number(codeValue);
  return isNaN(numCode) ? null : numCode;
}

/**
 * Extract Meta error subcode (e.g., 131030 might have additional info)
 * @param {Error|Object} err - Error object
 * @returns {string|null} Error subcode if found
 */
function extractMetaErrorSubcode(err) {
  return (
    err?.error?.error_subcode ||
    err?.response?.data?.error?.error_subcode ||
    null
  );
}

/**
 * Extract Meta error_data (additional context like send_attempt_count, etc.)
 * @param {Error|Object} err - Error object
 * @returns {Object|null} Error data object if found
 */
function extractMetaErrorData(err) {
  return (
    err?.error?.error_data || err?.response?.data?.error?.error_data || null
  );
}

/**
 * Extract error message from various error structures
 * @param {Error|Object} err - Error object
 * @returns {string} Error message
 */
function extractErrorMessage(err) {
  return (
    err?.message ||
    err?.error?.message ||
    err?.response?.data?.error?.message ||
    err?.response?.statusText ||
    "Unknown error"
  );
}

/**
 * Check if error is a network/system error (always retryable)
 * @param {Error|Object} err - Error object
 * @returns {boolean} True if network/system error
 */
function isNetworkSystemError(err) {
  if (!err) return false;

  const code = String(err?.code || "").toUpperCase();
  if (RETRYABLE_NETWORK_CODES.has(code)) return true;

  const message = String(err?.message || "").toUpperCase();
  return Array.from(RETRYABLE_NETWORK_CODES).some((netCode) =>
    message.includes(netCode),
  );
}

/**
 * Meta/account authorization failures are configuration errors, not recipient
 * failures. Retrying will not help until the token, permission, or phone number
 * mapping is fixed.
 */
function isMetaAuthConfigError(err) {
  if (!err) return false;

  const metaCode = extractMetaErrorCode(err);
  const status = Number(err?.meta_response_status || err?.response?.status);
  const message = String(extractErrorMessage(err) || "").toLowerCase();

  return (
    metaCode === 131005 ||
    metaCode === 190 ||
    metaCode === 200 ||
    status === 401 ||
    status === 403 ||
    message.includes("access denied") ||
    message.includes("access token") ||
    message.includes("permissions")
  );
}

/**
 * Classify an error as PERMANENT or RETRYABLE
 * Prefers numeric error code classification, falls back to pattern matching
 * @param {Error|Object} err - Error object
 * @returns {boolean} True if error is permanent (should not retry)
 */
function isFinallyPermanent(err) {
  if (!err) return false;

  // Network errors are always retryable
  if (isNetworkSystemError(err)) return false;

  // Check if explicitly marked as validation error
  if (err?.validation === true) return true;

  // Auth/config errors belong to the tenant/account setup, not a recipient.
  if (isMetaAuthConfigError(err)) return false;

  // Extract Meta error code for numeric classification
  const metaCode = extractMetaErrorCode(err);

  // If we have a Meta error code, use numeric classification
  if (metaCode !== null) {
    if (RETRYABLE_META_CODES.has(metaCode)) return false;
    if (PERMANENT_META_CODES.has(metaCode)) return true;
    // For unknown codes, check HTTP status range
    if (metaCode >= 400 && metaCode < 500) return true; // Client errors usually permanent
    if (metaCode >= 500 && metaCode < 600) return false; // Server errors usually retryable
  }

  // Fallback: pattern matching on error message (less reliable)
  const lower = String(err?.message || "").toLowerCase();
  if (PERMANENT_ERROR_PATTERNS.some((p) => lower.includes(p))) return true;

  // If we extracted a Meta code but it's unknown, be conservative and retry
  if (metaCode !== null && metaCode > 0) return false;

  // Default: treat as retryable to avoid data loss
  return false;
}

/**
 * Create a structured error object for storage
 * @param {Error|Object} err - Original error
 * @returns {Object} Structured error with code, subcode, message, and raw error data
 */
function createStructuredError(err) {
  return {
    code: extractMetaErrorCode(err),
    subcode: extractMetaErrorSubcode(err),
    message: extractErrorMessage(err),
    error_data: extractMetaErrorData(err),
    is_network_error: isNetworkSystemError(err),
    is_permanent: isFinallyPermanent(err),
    timestamp: new Date().toISOString(),
    // Store raw error for debugging if needed
    raw_error: err?.stack || String(err),
  };
}

/**
 * Format error for logging (concise version for logs)
 * @param {Error|Object} err - Original error
 * @returns {string} Formatted error string for logging
 */
function formatErrorForLogging(err) {
  const code = extractMetaErrorCode(err);
  const message = extractErrorMessage(err);
  const subcode = extractMetaErrorSubcode(err);

  if (code) {
    return `Meta code=${code}${subcode ? ` (subcode=${subcode})` : ""}: ${message}`;
  }
  return message;
}

export {
  isNetworkSystemError,
  isFinallyPermanent,
  extractMetaErrorCode,
  extractMetaErrorSubcode,
  extractMetaErrorData,
  extractErrorMessage,
  isMetaAuthConfigError,
  createStructuredError,
  formatErrorForLogging,
  PERMANENT_META_CODES,
  RETRYABLE_META_CODES,
  PERMANENT_ERROR_PATTERNS,
};
