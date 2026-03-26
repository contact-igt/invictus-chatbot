import express from "express";
import {
  createTenantController,
  deleteTenantController,
  softDeleteTenantController,
  getAllTenantController,
  getTenantByIdController,
  updateTenantController,
  resendTenantInvitationController,
  updateTenantStatusController,
  getTenantWebhookStatusController,
  getDeletedTenantListController,
  restoreTenantController,
  getTenantInvitationListController,
  getOnboardedTenantListController,
  getTenantSettingsController,
  updateTenantAiSettingsController,
} from "./tenant.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get(
  "/invitations",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getTenantInvitationListController,
);

Router.get(
  "/onboarded",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getOnboardedTenantListController,
);

Router.get(
  "/deleted-list",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getDeletedTenantListController,
);

Router.post(
  "/",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  createTenantController,
);

Router.get(
  "/list",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getAllTenantController,
);

Router.put(
  "/:id/status",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  updateTenantStatusController,
);

Router.delete(
  "/:id/soft",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  softDeleteTenantController,
);

Router.post(
  "/:id/restore",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  restoreTenantController,
);

Router.delete(
  "/:id/permanent",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  deleteTenantController,
);

Router.post(
  "/:tenant_user_id/resend-invite",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  resendTenantInvitationController,
);

Router.get(
  "/:id/webhook-status",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  getTenantWebhookStatusController,
);

Router.get(
  "/settings/general",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "staff", "doctor", "agent"],
  }),
  getTenantSettingsController,
);

Router.patch(
  "/settings/ai",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  updateTenantAiSettingsController,
);

Router.get(
  "/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getTenantByIdController,
);

Router.put(
  "/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  updateTenantController,
);

export default Router;
