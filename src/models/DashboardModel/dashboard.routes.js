import express from "express";
import { getDashboardController } from "./dashboard.controller.js";
import {
  getWeeklySummaryController,
  getContactWeeklySummaryController,
} from "./weeklySummary.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { requireAiAccess } from "../../middlewares/billing/billingAccessGuard.js";

const Router = express.Router();

/**
 * GET Dashboard Statistics
 * Endpoint: /api/whatsapp/dashboard
 * Protected: Requires Auth + Tenant-level Access
 */
Router.get(
  "/dashboard",
  authenticate,
  authorize({
    user_type: "tenant",
    // [DOCTOR ROLE UNWIRED – 2026-05-13] "doctor" removed
    roles: ["tenant_admin", /* "doctor", */ "staff"],
  }),
  getDashboardController,
);

/**
 * GET Weekly Summary for Tenant Dashboard
 * Endpoint: /api/whatsapp/weekly-summary
 * Returns 4 weeks of aggregated statistics
 */
Router.get(
  "/weekly-summary",
  authenticate,
  authorize({
    user_type: "tenant",
    // [DOCTOR ROLE UNWIRED – 2026-05-13] "doctor" removed
    roles: ["tenant_admin", /* "doctor", */ "staff"],
  }),
  requireAiAccess,
  getWeeklySummaryController,
);

/**
 * GET Weekly Summary for a Specific Contact
 * Endpoint: /api/whatsapp/weekly-summary/contact/:contactId
 * Query: ?phone=1234567890
 * Returns 4 weeks of conversation analytics for the contact
 */
Router.get(
  "/weekly-summary/contact/:contactId?",
  authenticate,
  authorize({
    user_type: "tenant",
    // [DOCTOR ROLE UNWIRED – 2026-05-13] "doctor" removed
    roles: ["tenant_admin", /* "doctor", */ "staff"],
  }),
  requireAiAccess,
  getContactWeeklySummaryController,
);

export default Router;
