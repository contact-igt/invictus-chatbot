import db from "../../database/index.js";
import { checkBillingAccess } from "../../services/billingAccess.service.js";
export { checkBillingAccess };
import {
  estimateMetaCost,
  estimateAiCost,
} from "../../utils/billing/costEstimator.js";
import { checkUsageLimit } from "../../utils/billing/usageLimiter.js";
import { recordHealthEvent } from "../../utils/billing/billingHealthMonitor.js";

// Default token estimate for AI calls when exact count is unknown
const AVG_TOKEN_ESTIMATE = { prompt: 1000, completion: 500 };

const handleBillingGuardFailure = async (res, guardName, tenant_id, error) => {
  console.error(`[BILLING-GUARD] ${guardName} error:`, error.message);
  await recordHealthEvent(
    "billing_failure",
    tenant_id || null,
    `${guardName} failed: ${error.message}`,
    {
      guard: guardName,
      stack: error.stack,
    },
  );

  return res.status(503).json({
    success: false,
    blocked: true,
    reason:
      "Billing validation is temporarily unavailable. Please try again shortly.",
  });
};

/**
 * Middleware: Require sufficient balance for Meta message sending.
 * Estimates cost from template category (if template_id provided) or req.body.category.
 */
export const requireSufficientBalance = async (req, res, next) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return next();

    let category = (req.body.category || "utility").toLowerCase();

    // Look up tenant's country and phone code
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["country", "owner_country_code", "timezone"],
      raw: true,
    });
    const isIndia =
      tenant?.owner_country_code === "91" ||
      tenant?.timezone === "Asia/Kolkata";
    const country =
      req.body.country || tenant?.country || (isIndia ? "IN" : "Global");

    // If template_id is provided, look up the actual template category from DB
    if (req.body.template_id) {
      try {
        const template = await db.WhatsappTemplates.findOne({
          where: { template_id: req.body.template_id, tenant_id },
          attributes: ["category"],
          raw: true,
        });
        if (template?.category) {
          category = template.category.toLowerCase();
        }
      } catch (_) {
        // Fallback to default category on error
      }
    }

    const cost = await estimateMetaCost(category, country);
    const estimated_cost = cost.totalCostInr;

    // Usage limit check
    const usageCheck = await checkUsageLimit(tenant_id, "message");
    if (!usageCheck.allowed) {
      return res.status(403).json({
        success: false,
        blocked: true,
        reason: usageCheck.reason,
        daily: usageCheck.daily,
        monthly: usageCheck.monthly,
      });
    }

    const access = await checkBillingAccess(tenant_id, estimated_cost);
    if (!access.allowed) {
      return res.status(403).json({ success: false, ...access });
    }

    next();
  } catch (error) {
    return handleBillingGuardFailure(
      res,
      "requireSufficientBalance",
      req.user?.tenant_id,
      error,
    );
  }
};

/**
 * Middleware: Require AI access (checks billing before AI call).
 * Uses conservative token estimate if exact count unknown.
 */
export const requireAiAccess = async (req, res, next) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return next();

    const model = req.body.model || "gpt-4o-mini";
    const cost = await estimateAiCost(
      model,
      AVG_TOKEN_ESTIMATE.prompt,
      AVG_TOKEN_ESTIMATE.completion,
    );
    const estimated_cost = cost.finalCostInr;

    // Usage limit check
    const usageCheck = await checkUsageLimit(tenant_id, "ai_call");
    if (!usageCheck.allowed) {
      return res.status(403).json({
        success: false,
        blocked: true,
        reason: usageCheck.reason,
        daily: usageCheck.daily,
        monthly: usageCheck.monthly,
      });
    }

    const access = await checkBillingAccess(tenant_id, estimated_cost);
    if (!access.allowed) {
      return res.status(403).json({ success: false, ...access });
    }

    next();
  } catch (error) {
    return handleBillingGuardFailure(
      res,
      "requireAiAccess",
      req.user?.tenant_id,
      error,
    );
  }
};

/**
 * Middleware: Require campaign access.
 * Estimates cost = metaCost × actual pending recipient count from DB.
 */
export const requireCampaignAccess = async (req, res, next) => {
  try {
    const tenant_id = req.user?.tenant_id;
    if (!tenant_id) return next();

    const campaign_id = req.params.campaign_id;

    // Query actual pending recipient count from DB — never trust req.body
    let recipientCount = 1;
    if (campaign_id) {
      const countResult = await db.WhatsappCampaignRecipients.count({
        where: { campaign_id, status: "pending" },
      });
      const pendingCount = countResult || 1;

      // For manual execute we only need access to start one execution batch.
      // Ongoing per-batch billing checks will pause the campaign if funds drop.
      const batchGuardSize = parseInt(
        process.env.CAMPAIGN_EXECUTE_GUARD_BATCH_SIZE || "15",
        10,
      );
      recipientCount = Math.max(1, Math.min(pendingCount, batchGuardSize));
    }

    // Get template category from campaign's template
    let category = (req.body.category || "marketing").toLowerCase();
    if (campaign_id) {
      const campaign = await db.WhatsappCampaigns.findOne({
        where: { campaign_id, tenant_id },
        include: [
          {
            model: db.WhatsappTemplates,
            as: "template",
            attributes: ["category"],
          },
        ],
        attributes: ["campaign_id"],
      });
      if (campaign?.template?.category) {
        category = campaign.template.category.toLowerCase();
      }
    }

    // Look up tenant's country and phone code
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["country", "owner_country_code", "timezone"],
      raw: true,
    });
    const isIndia =
      tenant?.owner_country_code === "91" ||
      tenant?.timezone === "Asia/Kolkata";
    const country =
      req.body.country || tenant?.country || (isIndia ? "IN" : "Global");

    const cost = await estimateMetaCost(category, country);
    const estimated_cost = cost.totalCostInr * recipientCount;

    const access = await checkBillingAccess(tenant_id, estimated_cost);
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        ...access,
        message: access.reason,
        recipient_count: recipientCount,
        estimated_cost,
      });
    }

    next();
  } catch (error) {
    return handleBillingGuardFailure(
      res,
      "requireCampaignAccess",
      req.user?.tenant_id,
      error,
    );
  }
};
