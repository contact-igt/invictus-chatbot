/**
 * Tax Settings Service
 *
 * Manages the dynamic GST rate table.
 * Provides a cached getActiveGSTRate() used by all billing operations.
 *
 * Cache TTL: 60 seconds. Invalidated immediately on activation.
 *
 * Design constraint: Only ONE row may have is_active = true at any time.
 * This is enforced inside a serialized transaction — not by a DB partial index,
 * because MySQL <8.0 does not support partial/filtered unique indexes.
 */

import db from "../database/index.js";
import { logger } from "../utils/logger.js";
import { getIO } from "../middlewares/socket/socket.js";
import { recordBillingHealthEvent } from "../utils/healthEventService.js";

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const DEFAULT_GST_RATE = 18.0;
const GST_AUDIT_COMPAT_TENANT_ID = "GLOBAL_GST";
const GST_AUDIT_COMPAT_ACTION_TYPE = "pricing_update";

let _cachedRate = null;
let _cacheTimestamp = 0;
let _lastFallbackHealthReportAt = 0;

async function reportGstFallback(message, metadata = {}) {
  const now = Date.now();
  if (now - _lastFallbackHealthReportAt < CACHE_TTL_MS) {
    return;
  }

  _lastFallbackHealthReportAt = now;
  await recordBillingHealthEvent({
    event_type: "gst_fallback",
    tenant_id: null,
    error_message: message,
    metadata: {
      source: "tax_settings_service",
      ...metadata,
    },
  });
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function _isCacheValid() {
  return _cachedRate !== null && Date.now() - _cacheTimestamp < CACHE_TTL_MS;
}

function _setCache(rate) {
  _cachedRate = rate;
  _cacheTimestamp = Date.now();
}

export function invalidateTaxCache() {
  _cachedRate = null;
  _cacheTimestamp = 0;
}

async function notifyTenantsAboutGstRateChange(io, payload) {
  const tenants = await db.Tenants.findAll({
    attributes: ["tenant_id"],
    raw: true,
  });

  for (const tenant of tenants) {
    if (!tenant?.tenant_id) continue;
    io.to(`tenant-${tenant.tenant_id}`).emit("gst-rate-changed", payload);
  }
}

async function fetchActiveRateRecord() {
  return db.TaxSettings.findOne({
    where: { is_active: true },
    attributes: ["id", "gst_rate", "effective_from", "notes"],
    raw: true,
  });
}

async function emitGstRateChanged(payload) {
  try {
    const io = getIO();
    io.to("management-room").emit("gst-rate-changed", payload);
    await notifyTenantsAboutGstRateChange(io, payload);
  } catch (err) {
    logger.debug("[TAX] Failed to emit GST socket event", err?.message || err);
  }
}

async function createGstAuditLog({
  adminId,
  actionType,
  reason,
  details,
  beforeState,
  afterState,
}) {
  const payload = {
    admin_id: adminId,
    tenant_id: null,
    action_type: actionType,
    details: {
      scope: "gst_rate",
      ...details,
    },
    before_state: beforeState,
    after_state: afterState,
    reason,
  };

  try {
    await db.AdminAuditLog.create(payload);
  } catch (err) {
    const message = err?.message || "";
    const needsCompatibilityFallback =
      message.includes("tenant_id cannot be null") ||
      message.includes("notNull Violation") ||
      message.includes("Data truncated") ||
      message.includes("Incorrect enum value");

    if (!needsCompatibilityFallback) {
      throw err;
    }

    await db.AdminAuditLog.create({
      ...payload,
      tenant_id: GST_AUDIT_COMPAT_TENANT_ID,
      action_type: GST_AUDIT_COMPAT_ACTION_TYPE,
    });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the currently active GST rate as a number (e.g. 18.0).
 * Falls back to 18.0 if the table is empty or unreachable.
 * Result is cached for 60 seconds to avoid per-request DB hits.
 */
export const getActiveGSTRate = async () => {
  if (_isCacheValid()) return _cachedRate;

  try {
    const record = await fetchActiveRateRecord();

    const rate = record ? parseFloat(record.gst_rate) : DEFAULT_GST_RATE;

    if (!record) {
      logger.warn(
        `[TAX] No active GST rate found in tax_settings — using default ${DEFAULT_GST_RATE}%`,
      );
      await reportGstFallback(
        `No active GST rate found in tax_settings. Using default ${DEFAULT_GST_RATE}%.`,
        { fallbackRate: DEFAULT_GST_RATE },
      );
    }

    _setCache(rate);
    return rate;
  } catch (err) {
    logger.error(`[TAX] Failed to fetch active GST rate: ${err.message}`);
    await reportGstFallback(
      `Failed to fetch active GST rate: ${err.message}. Using default ${DEFAULT_GST_RATE}%.`,
      { fallbackRate: DEFAULT_GST_RATE },
    );
    // Do NOT cache the fallback so the next request retries the DB
    return DEFAULT_GST_RATE;
  }
};

export const getConfiguredActiveGSTRate = async () => {
  try {
    const record = await fetchActiveRateRecord();
    return record ? parseFloat(record.gst_rate) : null;
  } catch (err) {
    logger.error(
      `[TAX] Failed to fetch configured active GST rate: ${err.message}`,
    );
    return null;
  }
};

/**
 * Insert a new GST rate (inactive by default).
 * Does NOT activate it — call activateGSTRate() separately.
 *
 * @param {number} gstRate       - 0 < gstRate <= 100
 * @param {Date|string} effectiveFrom - When this rate becomes effective
 * @param {string} createdBy     - Admin management_id
 * @param {string} [notes]       - Optional description / reference
 * @returns {Promise<object>}    - Created TaxSettings record
 */
export const addGSTRate = async (gstRate, effectiveFrom, createdBy, notes) => {
  const rate = parseFloat(gstRate);
  if (isNaN(rate) || rate <= 0 || rate > 100) {
    throw new Error("GST rate must be a number between 0 and 100");
  }

  if (!effectiveFrom) {
    throw new Error("effective_from date is required");
  }

  const effectiveDate = new Date(effectiveFrom);
  if (isNaN(effectiveDate.getTime())) {
    throw new Error("effective_from must be a valid date");
  }

  const record = await db.TaxSettings.create({
    gst_rate: rate,
    effective_from: effectiveDate,
    is_active: false,
    created_by: createdBy,
    notes: notes || null,
  });

  logger.info(
    `[TAX] New GST rate ${rate}% added (id=${record.id}) by admin ${createdBy} — not yet active`,
  );

  return record.toJSON();
};

/**
 * Activate a GST rate by id.
 *
 * Steps (all inside a single serialized transaction):
 *   1. Load the target rate record.
 *   2. Deactivate all currently active rates.
 *   3. Activate the target rate.
 *   4. Invalidate the in-memory cache.
 *   5. Emit a management-room socket event.
 *
 * Safety check (Part 7):
 *   If there are open (active, non-locked) billing cycles AND force !== true,
 *   the call is rejected with an informative error. Pass force=true to override.
 *
 * @param {number} id            - TaxSettings row id to activate
 * @param {string} adminId       - Management admin ID performing the action
 * @param {boolean} [force=false]- Skip the active-cycle safety check
 * @returns {Promise<{ old_rate: number, new_rate: number }>}
 */
export const activateGSTRate = async (id, adminId, force = false) => {
  // ── Safety check ────────────────────────────────────────────────────────────
  if (!force) {
    const openCycles = await db.BillingCycles.count({
      where: { status: "active", is_locked: false },
    });

    if (openCycles > 0) {
      throw Object.assign(
        new Error(
          `Cannot activate new GST rate: ${openCycles} billing cycle(s) are currently open. ` +
            `Close them first or pass force=true to apply from the next cycle only.`,
        ),
        { code: "OPEN_CYCLES", open_cycles: openCycles },
      );
    }
  }

  let old_rate = null;
  let new_rate = null;

  await db.sequelize.transaction(
    { isolationLevel: db.Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE },
    async (t) => {
      // 1. Load target
      const target = await db.TaxSettings.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!target) throw new Error(`GST rate id=${id} not found`);
      if (target.is_active) {
        throw new Error(`GST rate id=${id} is already active`);
      }

      // 2. Capture old rate
      const currentActive = await db.TaxSettings.findOne({
        where: { is_active: true },
        transaction: t,
        lock: t.LOCK.UPDATE,
        raw: true,
      });
      old_rate = currentActive ? parseFloat(currentActive.gst_rate) : null;
      new_rate = parseFloat(target.gst_rate);

      // 3. Deactivate all active rows
      await db.TaxSettings.update(
        { is_active: false },
        { where: { is_active: true }, transaction: t },
      );

      // 4. Activate the chosen row
      await target.update({ is_active: true }, { transaction: t });
    },
  );

  // 5. Invalidate cache so next call reads fresh value
  invalidateTaxCache();

  // 6. Audit log
  await createGstAuditLog({
    adminId,
    actionType: "gst_rate_change",
    details: { event: "activated", tax_settings_id: id, new_rate },
    beforeState: { gst_rate: old_rate, is_active: false },
    afterState: { gst_rate: new_rate, is_active: true },
    reason: `GST rate changed from ${old_rate ?? "N/A"}% to ${new_rate}%`,
  });

  // 7. Notify management and tenant billing UIs in real-time
  await emitGstRateChanged({
    action: "activated",
    old_rate,
    new_rate,
    activated_by: adminId,
    activated_at: new Date().toISOString(),
  });

  logger.info(
    `[TAX] GST rate activated: ${old_rate ?? "N/A"}% → ${new_rate}% by admin ${adminId}`,
  );

  return { old_rate, new_rate };
};

export const deactivateGSTRate = async (id, adminId) => {
  let old_rate = null;

  await db.sequelize.transaction(
    { isolationLevel: db.Sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE },
    async (t) => {
      const target = await db.TaxSettings.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!target) throw new Error(`GST rate id=${id} not found`);
      if (!target.is_active) {
        throw new Error(`GST rate id=${id} is already inactive`);
      }

      old_rate = parseFloat(target.gst_rate);
      await target.update({ is_active: false }, { transaction: t });
    },
  );

  invalidateTaxCache();

  await createGstAuditLog({
    adminId,
    actionType: "gst_rate_deactivate",
    details: { event: "deactivated", tax_settings_id: id, old_rate },
    beforeState: { gst_rate: old_rate, is_active: true },
    afterState: { gst_rate: old_rate, is_active: false },
    reason: `GST rate ${old_rate}% deactivated`,
  });

  await emitGstRateChanged({
    action: "deactivated",
    old_rate,
    new_rate: null,
    deactivated_by: adminId,
    deactivated_at: new Date().toISOString(),
  });

  logger.info(`[TAX] GST rate deactivated: ${old_rate}% by admin ${adminId}`);

  return { old_rate, new_rate: null };
};

export const deleteGSTRate = async (id, adminId) => {
  const target = await db.TaxSettings.findByPk(id);

  if (!target) throw new Error(`GST rate id=${id} not found`);

  if (target.is_active) {
    throw Object.assign(
      new Error(
        `Cannot delete active GST rate id=${id}. Deactivate it first or activate another rate before deleting.`,
      ),
      { code: "ACTIVE_RATE_DELETE_BLOCKED" },
    );
  }

  const deleted_rate = parseFloat(target.gst_rate);

  await target.destroy();

  await createGstAuditLog({
    adminId,
    actionType: "gst_rate_delete",
    details: { event: "deleted", tax_settings_id: id, deleted_rate },
    beforeState: {
      gst_rate: deleted_rate,
      effective_from: target.effective_from,
      is_active: false,
      notes: target.notes,
    },
    afterState: null,
    reason: `GST rate ${deleted_rate}% deleted`,
  });

  await emitGstRateChanged({
    action: "deleted",
    old_rate: null,
    new_rate: null,
    deleted_rate,
    deleted_by: adminId,
    deleted_at: new Date().toISOString(),
  });

  logger.info(
    `[TAX] GST rate deleted: ${deleted_rate}% (id=${id}) by admin ${adminId}`,
  );

  return { deleted_rate };
};

/**
 * Update an existing GST rate record (only allowed on inactive rates).
 * Editable fields: gst_rate, effective_from, notes.
 *
 * @param {number} id
 * @param {object} updates  - { gst_rate?, effective_from?, notes? }
 * @param {string} adminId
 * @returns {Promise<object>} - Updated record
 */
export const updateGSTRate = async (id, updates, adminId) => {
  const target = await db.TaxSettings.findByPk(id);
  if (!target) throw new Error(`GST rate id=${id} not found`);
  if (target.is_active) {
    throw Object.assign(
      new Error("Cannot edit an active GST rate. Deactivate it first."),
      { code: "ACTIVE_RATE_EDIT_BLOCKED" },
    );
  }

  const patch = {};

  if (updates.gst_rate !== undefined) {
    const rate = parseFloat(updates.gst_rate);
    if (isNaN(rate) || rate <= 0 || rate > 100) {
      throw new Error("gst_rate must be a number between 0 and 100");
    }
    patch.gst_rate = rate;
  }

  if (updates.effective_from !== undefined) {
    const effectiveDate = new Date(updates.effective_from);
    if (isNaN(effectiveDate.getTime())) {
      throw new Error("effective_from must be a valid date");
    }
    patch.effective_from = effectiveDate;
  }

  if (updates.notes !== undefined) {
    patch.notes = updates.notes || null;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error("No valid fields to update");
  }

  await target.update(patch);

  logger.info(
    `[TAX] GST rate id=${id} updated by admin ${adminId}: ${JSON.stringify(patch)}`,
  );

  return target.toJSON();
};

/**
 * Return paginated GST rate history (newest first).
 *
 * @param {number} [page=1]
 * @param {number} [limit=20]
 * @returns {Promise<{ rates: object[], pagination: object }>}
 */
export const listGSTRates = async (page = 1, limit = 20) => {
  const offset = (page - 1) * limit;

  const { count, rows } = await db.TaxSettings.findAndCountAll({
    order: [["created_at", "DESC"]],
    limit: parseInt(limit),
    offset,
    raw: true,
  });

  // Enrich with admin names
  const adminIds = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
  const admins = await db.Management.findAll({
    where: { management_id: adminIds },
    attributes: ["management_id", "username"],
    raw: true,
  });
  const adminMap = admins.reduce((acc, a) => {
    acc[a.management_id] = a.username;
    return acc;
  }, {});

  const rates = rows.map((r) => ({
    ...r,
    gst_rate: parseFloat(r.gst_rate),
    created_by_name: adminMap[r.created_by] || r.created_by,
  }));

  return {
    rates,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit),
    },
  };
};
