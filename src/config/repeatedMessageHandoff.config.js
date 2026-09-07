/**
 * Central configuration for the Repeated User Message → AI Handoff guard.
 *
 * Everything about this feature is OFF by default. When it is disabled (globally
 * or for a given tenant) every helper in
 * `src/services/repeatedMessageGuard.service.js` returns the permissive answer,
 * so WhatsNexus behaves exactly as it does today.
 *
 * Enable per tenant with an env allowlist (comma-separated tenant_ids):
 *   REPEATED_MESSAGE_HANDOFF_TENANTS=TNT-00007,TNT-00042
 * Or enable for everyone:
 *   REPEATED_MESSAGE_HANDOFF_ENABLED=true
 */

// Five total occurrences of the same normalized text. The first message is
// occurrence 1; the 5th matching inbound message triggers the handoff.
export const REPEATED_MESSAGE_THRESHOLD = 5;

// Streak continuity window. A matching message that arrives more than this many
// minutes after the previous matching message restarts the streak at 1.
// This ONLY affects the counter while AI is active — it never auto-resumes AI.
export const REPEATED_MESSAGE_WINDOW_MINUTES = 10;

// The single handoff notice sent on the 5th message. Not an AI response.
export const REPEATED_MESSAGE_HANDOFF_TEXT = "Our team will contact you instantly.";

// ai_pause_reason values. Only `manual` and `repeated_user_message` are
// implemented in this task. `repeated_ai_reply` is reserved for later.
export const AI_PAUSE_REASONS = Object.freeze({
  MANUAL: "manual",
  REPEATED_USER_MESSAGE: "repeated_user_message",
  REPEATED_AI_REPLY: "repeated_ai_reply",
});

// ai_handoff_events.status values.
export const HANDOFF_EVENT_STATUS = Object.freeze({
  PENDING: "pending",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  UNKNOWN: "unknown",
  CANCELLED: "cancelled",
});

// Bounded retry policy for known handoff send failures.
export const HANDOFF_MAX_ATTEMPTS = 3;

const truthy = (v) => ["1", "true", "yes", "on"].includes(String(v || "").trim().toLowerCase());

/**
 * Is the repeated-message handoff feature active for this tenant?
 * Read at call time so tests / rollout toggles take effect without a restart.
 * @param {string|null} tenantId
 * @returns {boolean}
 */
export const isRepeatedMessageHandoffEnabled = (tenantId = null) => {
  if (truthy(process.env.REPEATED_MESSAGE_HANDOFF_ENABLED)) return true;
  const allow = String(process.env.REPEATED_MESSAGE_HANDOFF_TENANTS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!tenantId) return false;
  return allow.includes(String(tenantId));
};
