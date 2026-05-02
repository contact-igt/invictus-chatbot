import express from "express";
import {
  deleteManagmentByIdController,
  getManagementByIdController,
  getManagementController,
  getLoggedManagementController,
  getLoggedManagementPreferencesController,
  updateLoggedManagementPreferencesController,
  loginManagementController,
  registerManagementController,
  softDeleteManagementController,
  updateManagementController,
  forgotManagementPasswordController,
  verifyManagementOTPController,
  resetManagementPasswordController,
  getDeletedManagementListController,
  restoreManagementController,
  getPricingRulesController,
  createPricingRuleController,
  updatePricingRuleController,
  deletePricingRuleController,
  getAiPricingRulesController,
  createAiPricingRuleController,
  updateAiPricingRuleController,
  deleteAiPricingRuleController,
} from "./management.controller.js";
import {
  addManualCreditController,
  getWalletStatusController,
} from "../BillingModel/billing.controller.js";
import {
  authenticate,
  authorize,
  refreshToken,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post(
  "/register",
  authenticate,
  authorize({ user_type: "management", roles: ["super_admin"] }),
  registerManagementController,
);

Router.post("/login", loginManagementController);

Router.get(
  "/profile",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getLoggedManagementController,
);

Router.get(
  "/preferences",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getLoggedManagementPreferencesController,
);

Router.put(
  "/preferences",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  updateLoggedManagementPreferencesController,
);

Router.get(
  "/list",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getManagementController,
);

// ─── Pricing Table CRUD Routes (Super Admin Only) ────────────

Router.get(
  "/pricing",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin", "platform_admin"],
  }),
  getPricingRulesController,
);

Router.post(
  "/pricing",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  createPricingRuleController,
);

Router.put(
  "/pricing/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  updatePricingRuleController,
);

Router.delete(
  "/pricing/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  deletePricingRuleController,
);

// ─── AI Model Pricing Routes (Super Admin Only) ────────────

Router.get(
  "/ai-pricing",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin", "platform_admin"],
  }),
  getAiPricingRulesController,
);

Router.post(
  "/ai-pricing",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  createAiPricingRuleController,
);

Router.put(
  "/ai-pricing/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  updateAiPricingRuleController,
);

Router.delete(
  "/ai-pricing/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  deleteAiPricingRuleController,
);

Router.get(
  "/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getManagementByIdController,
);

Router.put(
  "/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  updateManagementController,
);

Router.post("/refresh-token", refreshToken);

Router.delete(
  "/:id/soft",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  softDeleteManagementController,
);

Router.get(
  "/deleted/list",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin", "platform_admin"],
  }),
  getDeletedManagementListController,
);

Router.put(
  "/:id/restore",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  restoreManagementController,
);

Router.delete(
  "/:id/permanent",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  deleteManagmentByIdController,
);

Router.post("/forgot-password", forgotManagementPasswordController);

Router.post("/verify-otp", verifyManagementOTPController);
Router.post("/reset-password", resetManagementPasswordController);

// ─── Wallet Management (Super Admin Only) ────────────

// Get wallet status for a specific tenant
Router.get(
  "/wallet/:tenant_id/status",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin", "platform_admin"],
  }),
  getWalletStatusController,
);

// Add manual credit to a tenant's wallet
Router.post(
  "/wallet/credit",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  addManualCreditController,
);

export default Router;
