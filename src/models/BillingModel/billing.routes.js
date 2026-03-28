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
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

router.get("/billing/kpi", authenticate, getBillingKpiController);
router.get("/billing/ledger", authenticate, getBillingLedgerController);
router.get(
  "/billing/spend-chart",
  authenticate,
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
  authenticate,
  getBillingTemplateStatsController,
);
router.get(
  "/billing/campaign-stats",
  authenticate,
  getBillingCampaignStatsController,
);

// AI TOKEN USAGE
router.get("/billing/ai-usage", authenticate, getAiTokenUsageController);

// AVAILABLE AI MODELS (for tenant settings)
router.get("/billing/ai-models", authenticate, getAvailableAiModelsController);

// AUTO-RECHARGE SETTINGS
router.get(
  "/billing/auto-recharge",
  authenticate,
  getAutoRechargeSettingsController,
);
router.put(
  "/billing/auto-recharge",
  authenticate,
  updateAutoRechargeSettingsController,
);

// WALLET STATUS (for tenant to check their own suspension status)
router.get(
  "/billing/wallet/status",
  authenticate,
  getOwnWalletStatusController,
);

export default router;
