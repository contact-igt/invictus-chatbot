import {
  getWeeklySummaryService,
  getContactWeeklySummaryService,
} from "./weeklySummary.service.js";

/**
 * Get weekly summary for tenant dashboard
 * Returns 4 weeks of aggregated statistics
 */
export const getWeeklySummaryController = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    const summaries = await getWeeklySummaryService(tenantId);

    return res.status(200).json({
      success: true,
      data: {
        weeks: summaries,
        totalWeeks: summaries.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error in getWeeklySummaryController:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch weekly summary",
    });
  }
};

/**
 * Get weekly summary for a specific contact
 * Returns 4 weeks of conversation analytics for the contact
 */
export const getContactWeeklySummaryController = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { contactId } = req.params;
    const { phone } = req.query;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID is required",
      });
    }

    if (!contactId && !phone) {
      return res.status(400).json({
        success: false,
        message: "Contact ID or phone number is required",
      });
    }

    const summary = await getContactWeeklySummaryService(
      tenantId,
      contactId,
      phone,
    );

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error("Error in getContactWeeklySummaryController:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch contact weekly summary",
    });
  }
};
