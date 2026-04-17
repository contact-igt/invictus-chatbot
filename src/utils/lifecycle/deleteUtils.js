/**
 * deleteUtils.js
 *
 * Shared helpers for the soft-delete → restore → hard-delete lifecycle
 * that every Tier 1 table uses across this platform.
 *
 * Flow:
 *   softDelete()  → is_deleted=true, deleted_at=NOW()  (visible in Trash tab for 30 days)
 *   restoreItem() → is_deleted=false, deleted_at=NULL   (back to active list)
 *   hardDelete()  → physical DELETE (admin only)
 *
 * Cron job runs nightly and hard-deletes everything where
 *   is_deleted=true AND deleted_at < NOW() - 30 days
 */

export const RESTORE_WINDOW_DAYS = 30;

/**
 * How many full days have elapsed since the given date?
 * @param {Date|string} date
 * @returns {number}
 */
export const daysSince = (date) =>
  Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);

/**
 * How many full days remain before the restore window expires?
 * Returns 0 once the window has passed (never negative).
 * @param {Date|string} deletedAt
 * @returns {number}
 */
export const daysRemaining = (deletedAt) =>
  Math.max(0, RESTORE_WINDOW_DAYS - daysSince(deletedAt));

/**
 * Is a soft-deleted record still within the restore window?
 * @param {Date|string} deletedAt
 * @returns {boolean}
 */
export const isRestoreEligible = (deletedAt) => daysRemaining(deletedAt) > 0;

/**
 * Thrown when a caller tries to restore a record whose 30-day window has expired.
 * The controller maps this to HTTP 410 Gone.
 */
export class RestoreExpiredError extends Error {
  constructor(message = "Restore window has expired — this record can no longer be recovered") {
    super(message);
    this.name = "RestoreExpiredError";
    this.statusCode = 410;
  }
}

/**
 * Thrown when a record is not found or does not belong to the tenant.
 * Maps to HTTP 404.
 */
export class NotFoundError extends Error {
  constructor(message = "Record not found") {
    super(message);
    this.name = "NotFoundError";
    this.statusCode = 404;
  }
}

/**
 * Annotate each row from a getDeletedItems query with lifecycle metadata.
 *
 * Adds to every row:
 *   - days_remaining  {number}   — days left in restore window
 *   - can_restore     {boolean}  — true if still within window
 *
 * @param {object[]} rows  — raw DB rows, must have a deleted_at field
 * @returns {object[]}
 */
export const annotateDeletedRows = (rows) =>
  rows.map((row) => ({
    ...row,
    days_remaining: daysRemaining(row.deleted_at),
    can_restore:    isRestoreEligible(row.deleted_at),
  }));

/**
 * Build the standard lifecycle controller response handler.
 * Catches RestoreExpiredError (410) and NotFoundError (404) automatically.
 *
 * Usage:
 *   export const myController = lifecycleHandler(async (req, res) => {
 *     const data = await myService(...);
 *     return res.status(200).json({ message: "ok", data });
 *   });
 */
export const lifecycleHandler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof RestoreExpiredError) {
      return res.status(410).json({ message: err.message });
    }
    if (err instanceof NotFoundError) {
      return res.status(404).json({ message: err.message });
    }
    console.error("[Lifecycle]", err.message, err.stack);
    return res.status(500).json({ message: err.message || "Internal server error" });
  }
};
