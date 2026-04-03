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
} from "./invoice.controller.js";
import {
  authenticate,
  authorize,
  authenticateAdmin,
} from "../../middlewares/auth/authMiddlewares.js";

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
router.get("/billing/wallet", ...tenantAuth, getWalletBalanceController);
router.get(
  "/billing/wallet/transactions",
  ...tenantAuth,
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
router.post(
  "/billing/admin/force-unlock",
  authenticateAdmin,
  adminForceUnlockController,
);
router.post(
  "/billing/admin/manual-credit",
  authenticateAdmin,
  adminManualCreditController,
);
router.post(
  "/billing/admin/invoice-close",
  authenticateAdmin,
  adminInvoiceCloseController,
);
router.post(
  "/billing/admin/change-mode",
  authenticateAdmin,
  adminChangeBillingModeController,
);
router.get(
  "/billing/admin/audit-log",
  authenticateAdmin,
  adminGetAuditLogController,
);
router.get(
  "/billing/admin/health",
  authenticateAdmin,
  adminGetHealthSummaryController,
);
router.get("/billing/admin/tenants", authenticateAdmin, adminGetTenantsController);
router.get(
  "/billing/admin/tenant-overview",
  authenticateAdmin,
  adminGetTenantOverviewController,
);
router.post(
  "/billing/admin/health/:id/resolve",
  authenticateAdmin,
  adminResolveHealthEventController,
);
router.get(
  "/billing/admin/health/unresolved",
  authenticateAdmin,
  adminGetUnresolvedEventsController,
);

export default router;
