import db from "../../database/index.js";
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
 * Core billing access check. estimated_cost is REQUIRED — never defaults to 0.
 *
 * @param {string} tenant_id
 * @param {number} estimated_cost - Must be computed by caller
 * @returns {Promise<{ allowed: boolean, billing_mode: string, reason?: string, required?: number, available?: number, shortfall?: number }>}
 */
export const checkBillingAccess = async (tenant_id, estimated_cost) => {
  const tenant = await db.Tenants.findOne({
    where: { tenant_id },
    attributes: ["billing_mode", "postpaid_credit_limit"],
    raw: true,
  });
  const billing_mode = tenant?.billing_mode || "prepaid";

  if (billing_mode === "prepaid") {
    const wallet = await db.Wallets.findOne({
      where: { tenant_id },
      attributes: ["balance"],
      raw: true,
    });
    const balance = wallet ? parseFloat(wallet.balance) || 0 : 0;

    if (balance >= estimated_cost) {
      return { allowed: true, billing_mode };
    }

    return {
      allowed: false,
      blocked: true,
      billing_mode,
      reason: `Insufficient balance. Required: ₹${estimated_cost.toFixed(2)}, Available: ₹${balance.toFixed(2)}`,
      required: estimated_cost,
      available: balance,
      shortfall: estimated_cost - balance,
    };
  }

  // Postpaid
  // Check overdue invoices AND unpaid invoices past due date (real-time check)
  const overdueInvoice = await db.MonthlyInvoices.findOne({
    where: {
      tenant_id,
      [db.Sequelize.Op.or]: [
        { status: "overdue" },
        {
          status: "unpaid",
          due_date: { [db.Sequelize.Op.lt]: new Date() },
        },
      ],
    },
    attributes: ["invoice_number"],
    raw: true,
  });

  if (overdueInvoice) {
    return {
      allowed: false,
      blocked: true,
      billing_mode,
      reason: "You have an unpaid overdue invoice. Please pay to continue.",
    };
  }

  // Check credit limit
  const creditLimit = parseFloat(tenant?.postpaid_credit_limit) || 5000;
  const activeCycle = await db.BillingCycles.findOne({
    where: { tenant_id, status: "active" },
    attributes: ["total_cost_inr"],
    raw: true,
  });
  const currentUsage = activeCycle
    ? parseFloat(activeCycle.total_cost_inr) || 0
    : 0;

  if (currentUsage + estimated_cost > creditLimit) {
    return {
      allowed: false,
      blocked: true,
      billing_mode,
      reason: `Monthly credit limit of ₹${creditLimit.toFixed(2)} would be exceeded.`,
      required: estimated_cost,
      available: creditLimit - currentUsage,
    };
  }

  // Emit 80% credit warning (but still allow)
  if (currentUsage >= creditLimit * 0.8) {
    try {
      const { getIO } = await import("../../middlewares/socket/socket.js");
      const io = getIO();
      io.to(`tenant-${tenant_id}`).emit("credit-limit-warning", {
        usage: currentUsage,
        limit: creditLimit,
        percent: Math.round((currentUsage / creditLimit) * 100),
      });
    } catch (_) {}
  }

  return { allowed: true, billing_mode };
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
      recipientCount = countResult || 1;
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
