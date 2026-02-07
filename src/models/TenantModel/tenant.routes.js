import express from "express";
import {
  createTenantController,
  deleteTenantController,
  deleteTenantStatusController,
  getAllTenantController,
  getTenantByIdController,
  updateTenantController,
  resendTenantInvitationController,
  updateTenantStatusController,
} from "./tenant.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post(
  "/tenant",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  createTenantController,
);

Router.get(
  "/tenants",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getAllTenantController,
);

Router.get(
  "/tenant/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getTenantByIdController,
);

Router.put(
  "/tenant/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  updateTenantController,
);

Router.put(
  "/tenant-status/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  updateTenantStatusController,
);

Router.put(
  "/tenant-remove/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  deleteTenantStatusController,
);

Router.delete(
  "/tenant/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  deleteTenantController,
);

Router.post(
  "/tenant/resend-invite/:tenant_user_id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  resendTenantInvitationController,
);

export default Router;
