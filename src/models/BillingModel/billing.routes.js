import express from "express";
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
import {
  authenticate,
  authorize,
  authenticateAdmin,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  billingQueryRateLimiter,
  adminBillingRateLimiter,
} from "../../middlewares/billing/billingRateLimiter.js";

const router = express.Router();

// Tenant-only billing endpoints (require tenant user_type)
const tenantAuth = [authenticate, authorize({ user_type: "tenant" })];

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
router.get("/billing/invoices", authenticate, getInvoicesController);
router.get("/billing/invoices/:id", authenticate, getInvoiceDetailController);
router.post("/billing/invoices/:id/pay", ...tenantAuth, payInvoiceController);

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

export default router;
