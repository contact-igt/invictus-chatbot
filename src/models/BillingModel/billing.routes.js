import express from "express";
import db from "../../database/index.js";
import {
  getBillingKpiController,
  getBillingLedgerController,
  getBillingSpendChartController,
  getWalletBalanceController,
  getWalletTransactionsController,
  getPricingTableController,
  updatePricingController,
  getBillingTemplateStatsController,
  getBillingCampaignStatsController,
  getAiTokenUsageController,
  getAutoRechargeSettingsController,
  updateAutoRechargeSettingsController,
  getAvailableAiModelsController,
  getOwnWalletStatusController,
} from "./billing.controller.js";
import {
  getInvoicesController,
  getInvoiceDetailController,
  payInvoiceController,
  getBillingModeController,
  adminForceUnlockController,
  adminManualCreditController,
  adminInvoiceCloseController,
  adminChangeBillingModeController,
  adminGetAuditLogController,
  adminGetHealthSummaryController,
  adminGetTenantsController,
  adminResolveHealthEventController,
  adminGetTenantOverviewController,
  adminGetUnresolvedEventsController,
  adminUpdateUsageLimitsController,
} from "./invoice.controller.js";
import { calculateGST, formatGSTBreakdown } from "../../utils/gstCalculator.js";
import { getActiveGSTRate } from "../../services/taxSettings.service.js";
import {
  adminGetActiveGSTController,
  adminListGSTRatesController,
  adminAddGSTRateController,
  adminActivateGSTRateController,
  adminDeactivateGSTRateController,
  adminDeleteGSTRateController,
  adminUpdateGSTRateController,
} from "./gstAdmin.controller.js";
import { downloadInvoicePdf } from "../../controllers/invoice.controller.js";
import {
  authenticate,
  authorize,
  authenticateAdmin,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  billingQueryRateLimiter,
  adminBillingRateLimiter,
  invoicePaymentRateLimiter,
} from "../../middlewares/billing/billingRateLimiter.js";

const router = express.Router();

function getTenantStateCode(state) {
  return typeof state === "string" ? state.trim().toUpperCase() : "";
}

function getTenantAiSettings(aiSettings) {
  if (!aiSettings) {
    return {};
  }

  if (typeof aiSettings === "string") {
    try {
      return JSON.parse(aiSettings);
    } catch {
      return {};
    }
  }

  return aiSettings;
}

// Tenant-only billing endpoints (require tenant user_type)
const tenantAuth = [authenticate, authorize({ user_type: "tenant" })];

// GST breakdown for tenant dashboard
router.get("/billing/gst-breakdown", ...tenantAuth, async (req, res, next) => {
  try {
    const tenant_id = req.user.tenant_id;
    const companyState = process.env.COMPANY_STATE || "TN";

    // Fetch tenant's billing state
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["state", "ai_settings"],
      raw: true,
    });
    const tenantAiSettings = getTenantAiSettings(tenant?.ai_settings);
    const tenantState = getTenantStateCode(tenant?.state);
    const companyStateCode = getTenantStateCode(companyState);

    // Get recent wallet transactions with GST data
    const recentTransactions = await db.WalletTransactions.findAll({
      where: { tenant_id, type: "credit" },
      order: [["created_at", "DESC"]],
      limit: 5,
      attributes: [
        "gross_amount",
        "base_amount",
        "gst_amount",
        "gst_rate",
        "created_at",
      ],
      raw: true,
    });

    // Calculate totals from recent transactions
    let totalGrossAmount = 0;
    let totalBaseAmount = 0;
    let totalGstAmount = 0;

    recentTransactions.forEach((txn) => {
      if (txn.gross_amount) {
        totalGrossAmount += parseFloat(txn.gross_amount) || 0;
        totalBaseAmount += parseFloat(txn.base_amount) || 0;
        totalGstAmount += parseFloat(txn.gst_amount) || 0;
      }
    });

    const distinctRecentRates = [
      ...new Set(
        recentTransactions
          .map((txn) => {
            const rate = parseFloat(txn.gst_rate);
            return Number.isFinite(rate) ? rate : null;
          })
          .filter((rate) => rate !== null),
      ),
    ];

    const is_intra_state =
      tenantState && companyStateCode && tenantState === companyStateCode;

    const currentGstRate = await getActiveGSTRate();
    const summaryGstRate =
      distinctRecentRates.length === 1 ? distinctRecentRates[0] : null;
    const hasMixedRates = distinctRecentRates.length > 1;
    const breakdownRateSuffix = hasMixedRates
      ? " (mixed recent rates)"
      : summaryGstRate !== null
        ? ` (${summaryGstRate}%)`
        : recentTransactions.length === 0
          ? ` (current ${currentGstRate}%)`
          : "";

    res.json({
      success: true,
      gst: {
        gross_amount: totalGrossAmount.toFixed(2),
        base_amount: totalBaseAmount.toFixed(2),
        gst_amount: totalGstAmount.toFixed(2),
        gst_rate: summaryGstRate,
        current_rate: currentGstRate,
        has_mixed_rates: hasMixedRates,
        recent_rates: distinctRecentRates,
        is_intra_state,
        cgst_amount: is_intra_state ? (totalGstAmount / 2).toFixed(2) : "0.00",
        sgst_amount: is_intra_state ? (totalGstAmount / 2).toFixed(2) : "0.00",
        igst_amount: !is_intra_state ? totalGstAmount.toFixed(2) : "0.00",
      },
      breakdown: `₹${totalGrossAmount.toFixed(2)} paid → ₹${totalBaseAmount.toFixed(2)} credited to wallet + ₹${totalGstAmount.toFixed(2)} GST${breakdownRateSuffix}`,
      recentTransactions,
      company_state: companyStateCode,
      tenant_state: tenantState,
      tenant_gstin: tenantAiSettings.gstin || "",
    });
  } catch (err) {
    next(err);
  }
});

// Invoice PDF download (tenant)
router.get("/billing/invoices/:id/pdf", ...tenantAuth, downloadInvoicePdf);

// Invoice PDF download (SuperAdmin)
router.get(
  "/admin/invoices/:id/pdf",
  authenticateAdmin,
  adminBillingRateLimiter,
  downloadInvoicePdf,
);

router.get("/billing/kpi", ...tenantAuth, getBillingKpiController);
router.get("/billing/ledger", ...tenantAuth, getBillingLedgerController);
router.get(
  "/billing/spend-chart",
  ...tenantAuth,
  getBillingSpendChartController,
);
router.get("/billing/wallet", authenticate, getWalletBalanceController);
router.get(
  "/billing/wallet/transactions",
  authenticate,
  getWalletTransactionsController,
);

// PRICING MANAGEMENT — Use /management/pricing instead (canonical endpoints)
// These read-only billing pricing routes are kept for backward compatibility
router.get("/billing/pricing", authenticate, getPricingTableController);
// router.put("/billing/pricing/:id", authenticate, updatePricingController); // DEPRECATED: use PUT /management/pricing/:id

// STATS
router.get(
  "/billing/template-stats",
  ...tenantAuth,
  getBillingTemplateStatsController,
);
router.get(
  "/billing/campaign-stats",
  ...tenantAuth,
  getBillingCampaignStatsController,
);

// AI TOKEN USAGE
router.get("/billing/ai-usage", ...tenantAuth, getAiTokenUsageController);

// AVAILABLE AI MODELS (for tenant settings)
router.get("/billing/ai-models", authenticate, getAvailableAiModelsController);

// AUTO-RECHARGE SETTINGS
router.get(
  "/billing/auto-recharge",
  ...tenantAuth,
  getAutoRechargeSettingsController,
);
router.put(
  "/billing/auto-recharge",
  ...tenantAuth,
  updateAutoRechargeSettingsController,
);

// WALLET STATUS (for tenant to check their own suspension status)
router.get(
  "/billing/wallet/status",
  ...tenantAuth,
  getOwnWalletStatusController,
);

// BILLING MODE
router.get("/billing/mode", authenticate, getBillingModeController);

// INVOICES
// authenticate only — the controllers handle authorization internally:
//   management users → see all invoices (or filter by ?tenant_id)
//   tenant users     → scoped to their own tenant_id
// payInvoice is tenant-only (enforced inside the controller).
router.get(
  "/billing/invoices",
  authenticate,
  billingQueryRateLimiter,
  getInvoicesController,
);
router.get(
  "/billing/invoices/:id",
  authenticate,
  billingQueryRateLimiter,
  getInvoiceDetailController,
);
router.post(
  "/billing/invoices/:id/pay",
  authenticate,
  invoicePaymentRateLimiter,
  payInvoiceController,
);

// ADMIN BILLING OVERRIDES (require management + super_admin role)
// Mutation endpoints have an extra rate limiter to limit damage from compromised admin accounts
router.post(
  "/billing/admin/force-unlock",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminForceUnlockController,
);
router.post(
  "/billing/admin/manual-credit",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminManualCreditController,
);
router.post(
  "/billing/admin/invoice-close",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminInvoiceCloseController,
);
router.post(
  "/billing/admin/change-mode",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminChangeBillingModeController,
);
router.get(
  "/billing/admin/audit-log",
  authenticateAdmin,
  billingQueryRateLimiter,
  adminGetAuditLogController,
);
router.get(
  "/billing/admin/health",
  authenticateAdmin,
  billingQueryRateLimiter,
  adminGetHealthSummaryController,
);
router.get(
  "/billing/admin/tenants",
  authenticateAdmin,
  billingQueryRateLimiter,
  adminGetTenantsController,
);
router.get(
  "/billing/admin/tenant-overview",
  authenticateAdmin,
  billingQueryRateLimiter,
  adminGetTenantOverviewController,
);
router.post(
  "/billing/admin/health/:id/resolve",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminResolveHealthEventController,
);
router.get(
  "/billing/admin/health/unresolved",
  authenticateAdmin,
  billingQueryRateLimiter,
  adminGetUnresolvedEventsController,
);
router.put(
  "/billing/admin/usage-limits",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminUpdateUsageLimitsController,
);

// ─── GST Rate Management (SuperAdmin only) ────────────────────────────────────
router.get(
  "/billing/admin/gst/current",
  authenticateAdmin,
  billingQueryRateLimiter,
  adminGetActiveGSTController,
);
router.get(
  "/billing/admin/gst/list",
  authenticateAdmin,
  billingQueryRateLimiter,
  adminListGSTRatesController,
);
router.post(
  "/billing/admin/gst/add",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminAddGSTRateController,
);
router.post(
  "/billing/admin/gst/activate",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminActivateGSTRateController,
);
router.post(
  "/billing/admin/gst/deactivate",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminDeactivateGSTRateController,
);
router.put(
  "/billing/admin/gst/:id",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminUpdateGSTRateController,
);
router.delete(
  "/billing/admin/gst/:id",
  authenticateAdmin,
  adminBillingRateLimiter,
  adminDeleteGSTRateController,
);

export default router;
