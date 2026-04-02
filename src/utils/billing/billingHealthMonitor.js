import db from "../../database/index.js";
import { Op } from "sequelize";
import { getIO } from "../../middlewares/socket/socket.js";

/**
 * Record a billing system health event.
 *
 * @param {string} event_type   - billing_failure | payment_failure | cron_failure | invoice_error | lock_conflict | currency_fetch_error | reconciliation_mismatch | reconciliation_report
 * @param {string|null} tenant_id - Affected tenant (null for system-wide)
 * @param {string} error_message
 * @param {object} metadata     - Stack trace, context data
 */
export const recordHealthEvent = async (
  event_type,
  tenant_id,
  error_message,
  metadata = {},
) => {
  try {
    await db.BillingSystemHealth.create({
      event_type,
      tenant_id: tenant_id || null,
      error_message: error_message || "",
      metadata: metadata || {},
      resolved: false,
    });

    console.error(
      `[BILLING-HEALTH] ${event_type} | tenant=${tenant_id || "system"} | ${error_message}`,
    );
  } catch (err) {
    // Health monitor itself must never crash the caller
    console.error(
      "[BILLING-HEALTH] Failed to record health event:",
      err.message,
    );
  }
};

/**
 * Get health summary for the last 24 hours.
 * Grouped by event_type with counts.
 *
 * @returns {Promise<object>}
 */
export const getHealthSummary = async () => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const events = await db.BillingSystemHealth.findAll({
      where: { createdAt: { [Op.gte]: since } },
      attributes: [
        "event_type",
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
      ],
      group: ["event_type"],
      raw: true,
    });

    const summary = {};
    for (const e of events) {
      summary[e.event_type] = parseInt(e.count, 10);
    }

    const unresolvedCount = await db.BillingSystemHealth.count({
      where: { resolved: false },
    });

    return {
      period: "last_24h",
      events: summary,
      total_unresolved: unresolvedCount,
      generated_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[BILLING-HEALTH] getHealthSummary failed:", err.message);
    return {
      period: "last_24h",
      events: {},
      total_unresolved: 0,
      error: err.message,
    };
  }
};

/**
 * Check health alert thresholds and emit admin alerts.
 * Called by a 15-minute cron interval.
 */
export const checkHealthAlerts = async () => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Count events in last hour
    const recentCounts = await db.BillingSystemHealth.findAll({
      where: { createdAt: { [Op.gte]: oneHourAgo } },
      attributes: [
        "event_type",
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
      ],
      group: ["event_type"],
      raw: true,
    });

    const countMap = {};
    for (const r of recentCounts) {
      countMap[r.event_type] = parseInt(r.count, 10);
    }

    const alerts = [];

    if ((countMap.billing_failure || 0) > 10) {
      alerts.push({
        type: "billing_failure",
        count: countMap.billing_failure,
        window: "1h",
      });
    }
    if ((countMap.payment_failure || 0) > 5) {
      alerts.push({
        type: "payment_failure",
        count: countMap.payment_failure,
        window: "1h",
      });
    }

    // Check 24h window for critical events
    const dailyCounts = await db.BillingSystemHealth.findAll({
      where: { createdAt: { [Op.gte]: oneDayAgo } },
      attributes: [
        "event_type",
        [db.sequelize.fn("COUNT", db.sequelize.col("id")), "count"],
      ],
      group: ["event_type"],
      raw: true,
    });

    const dailyMap = {};
    for (const r of dailyCounts) {
      dailyMap[r.event_type] = parseInt(r.count, 10);
    }

    if ((dailyMap.cron_failure || 0) > 0) {
      alerts.push({
        type: "cron_failure",
        count: dailyMap.cron_failure,
        window: "24h",
      });
    }
    if ((dailyMap.invoice_error || 0) > 0) {
      alerts.push({
        type: "invoice_error",
        count: dailyMap.invoice_error,
        window: "24h",
      });
    }

    // Emit admin alert if any threshold breached
    if (alerts.length > 0) {
      try {
        const io = getIO();
        io.emit("billing-health-alert", {
          alerts,
          timestamp: new Date().toISOString(),
        });
      } catch (_) {}

      console.warn(
        "[BILLING-HEALTH] Alerts triggered:",
        JSON.stringify(alerts),
      );
    }

    return alerts;
  } catch (err) {
    console.error("[BILLING-HEALTH] checkHealthAlerts failed:", err.message);
    return [];
  }
};

/**
 * Mark a health event as resolved.
 */
export const resolveHealthEvent = async (eventId) => {
  try {
    await db.BillingSystemHealth.update(
      { resolved: true },
      { where: { id: eventId } },
    );
  } catch (err) {
    console.error("[BILLING-HEALTH] resolveHealthEvent failed:", err.message);
  }
};

/**
 * Get recent unresolved health events.
 */
export const getUnresolvedEvents = async (limit = 50) => {
  try {
    const events = await db.BillingSystemHealth.findAll({
      where: { resolved: false },
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
      raw: true,
    });
    return events;
  } catch (err) {
    console.error("[BILLING-HEALTH] getUnresolvedEvents failed:", err.message);
    return [];
  }
};
