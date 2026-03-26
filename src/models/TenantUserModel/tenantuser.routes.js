import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  createTenantUserController,
  getAllTenantUsersController,
  getTenantUserByIdController,
  loginTenantUserController,
  permanentDeleteTenantUserController,
  softDeleteTenantUserController,
  updateTenantUserByIdController,
  getDeletedTenantUserListController,
  restoreTenantUserController,
  getLoggedTenantUserController,
  updateTenantOrganizationController,
} from "./tenantuser.controller.js";

const Router = express.Router();

Router.post(
  "/user/create",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  createTenantUserController,
);

Router.post("/user/login", loginTenantUserController);

Router.get(
  "/user/profile",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  getLoggedTenantUserController,
);

Router.put(
  "/user/organization",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  updateTenantOrganizationController,
);

Router.get(
  "/user/list",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  getAllTenantUsersController,
);

Router.get(
  "/user/:tenant_user_id",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  getTenantUserByIdController,
);

Router.put(
  "/user/:tenant_user_id",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  updateTenantUserByIdController,
);

Router.delete(
  "/user/:tenant_user_id/soft",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  softDeleteTenantUserController,
);

Router.get(
  "/user/deleted/list",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  getDeletedTenantUserListController,
);

Router.put(
  "/user/:tenant_user_id/restore",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  restoreTenantUserController,
);

/* ⚠️ PERMANENT DELETE – USE CAREFULLY */
Router.delete(
  "/user/:tenant_user_id/permanent",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin"],
  }),
  permanentDeleteTenantUserController,
);

// --- Password Reset Routes ---
import {
  forgotTenantPasswordController,
  verifyTenantOTPController,
  resetTenantPasswordController,
} from "./tenantuser.controller.js";

Router.post("/user/forgot-password", forgotTenantPasswordController);
Router.post("/user/verify-otp", verifyTenantOTPController);
Router.post("/user/reset-password", resetTenantPasswordController);

export default Router;
