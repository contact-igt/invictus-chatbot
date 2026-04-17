import {
  getActiveGSTRate,
  getConfiguredActiveGSTRate,
  addGSTRate,
  activateGSTRate,
  deactivateGSTRate,
  deleteGSTRate,
  listGSTRates,
  updateGSTRate,
} from "../../services/taxSettings.service.js";
import { logger } from "../../utils/logger.js";

/**
 * GET /billing/admin/gst/current
 * Returns the currently active GST rate.
 */
export const adminGetActiveGSTController = async (req, res) => {
  try {
    const configuredRate = await getConfiguredActiveGSTRate();
    const fallbackRate = await getActiveGSTRate();
    res.json({
      success: true,
      gst_rate: configuredRate,
      configured_gst_rate: configuredRate,
      fallback_gst_rate: fallbackRate,
      has_configured_active_rate: configuredRate !== null,
    });
  } catch (error) {
    logger.error("[ADMIN-GST] getActiveGST error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /billing/admin/gst/list
 * Paginated history of all GST rate entries.
 */
export const adminListGSTRatesController = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await listGSTRates(parseInt(page), parseInt(limit));
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[ADMIN-GST] listGSTRates error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /billing/admin/gst/add
 * Add a new GST rate (inactive). Activate separately via /activate.
 *
 * Body: { gst_rate, effective_from, notes? }
 */
export const adminAddGSTRateController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { gst_rate, effective_from, notes } = req.body;

    if (gst_rate === undefined || gst_rate === null) {
      return res
        .status(400)
        .json({ success: false, message: "gst_rate is required" });
    }
    if (!effective_from) {
      return res
        .status(400)
        .json({ success: false, message: "effective_from is required" });
    }

    const rate = parseFloat(gst_rate);
    if (isNaN(rate) || rate <= 0 || rate > 100) {
      return res.status(400).json({
        success: false,
        message: "gst_rate must be a number between 0 and 100",
      });
    }

    const record = await addGSTRate(rate, effective_from, admin_id, notes);
    logger.info(
      `[ADMIN-GST] Rate ${rate}% added (id=${record.id}) by admin ${admin_id}`,
    );
    res.status(201).json({ success: true, data: record });
  } catch (error) {
    logger.error("[ADMIN-GST] addGSTRate error:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * POST /billing/admin/gst/activate
 * Activate a specific GST rate by id. Deactivates the current one atomically.
 *
 * Body: { id, force? }
 *   force: boolean — if true, skip the open-billing-cycle safety check
 */
export const adminActivateGSTRateController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { id, force = false } = req.body;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "id is required" });
    }

    const result = await activateGSTRate(
      parseInt(id),
      admin_id,
      Boolean(force),
    );

    res.json({
      success: true,
      message: `GST rate changed from ${result.old_rate ?? "N/A"}% to ${result.new_rate}%`,
      ...result,
    });
  } catch (error) {
    logger.error("[ADMIN-GST] activateGSTRate error:", error.message);

    // Return 409 for the open-cycles safety violation so the frontend can show
    // a specific "force?" confirmation dialog instead of a generic error.
    const status = error.code === "OPEN_CYCLES" ? 409 : 400;
    res.status(status).json({
      success: false,
      message: error.message,
      code: error.code || null,
      open_cycles: error.open_cycles || null,
    });
  }
};

/**
 * POST /billing/admin/gst/deactivate
 * Deactivate the currently active GST rate by id.
 *
 * Body: { id }
 */
export const adminDeactivateGSTRateController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { id } = req.body;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "id is required" });
    }

    const result = await deactivateGSTRate(parseInt(id), admin_id);

    res.json({
      success: true,
      message: `GST rate ${result.old_rate}% deactivated`,
      ...result,
    });
  } catch (error) {
    logger.error("[ADMIN-GST] deactivateGSTRate error:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * PUT /billing/admin/gst/:id
 * Edit an inactive GST rate (gst_rate, effective_from, notes).
 * Active rates cannot be edited — deactivate first.
 */
export const adminUpdateGSTRateController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { id } = req.params;
    const { gst_rate, effective_from, notes } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, message: "id is required" });
    }

    const record = await updateGSTRate(parseInt(id), { gst_rate, effective_from, notes }, admin_id);
    res.json({ success: true, message: "GST rate updated", data: record });
  } catch (error) {
    logger.error("[ADMIN-GST] updateGSTRate error:", error.message);
    const status = error.code === "ACTIVE_RATE_EDIT_BLOCKED" ? 409 : 400;
    res.status(status).json({
      success: false,
      message: error.message,
      code: error.code || null,
    });
  }
};

/**
 * DELETE /billing/admin/gst/:id
 * Delete an inactive GST rate.
 */
export const adminDeleteGSTRateController = async (req, res) => {
  try {
    const admin_id = req.user.unique_id;
    const { id } = req.params;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "id is required" });
    }

    const result = await deleteGSTRate(parseInt(id), admin_id);

    res.json({
      success: true,
      message: `GST rate ${result.deleted_rate}% deleted`,
      ...result,
    });
  } catch (error) {
    logger.error("[ADMIN-GST] deleteGSTRate error:", error.message);
    const status = error.code === "ACTIVE_RATE_DELETE_BLOCKED" ? 409 : 400;
    res.status(status).json({
      success: false,
      message: error.message,
      code: error.code || null,
    });
  }
};
