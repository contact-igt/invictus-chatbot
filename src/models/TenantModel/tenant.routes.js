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
} from "./tenant.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

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

Router.get(
  "/deleted/list",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getDeletedTenantListController,
);

Router.put(
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

export default Router;
