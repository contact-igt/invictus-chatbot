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
  getLoggedTenantUserPreferencesController,
  updateLoggedTenantUserPreferencesController,
  updateTenantOrganizationController,
  updateLoggedTenantProfileController,
    forgotTenantPasswordController,
  verifyTenantOTPController,
  resetTenantPasswordController,
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
    roles: ["tenant_admin" , "staff"],
  }),
  getLoggedTenantUserController,
);

Router.get(
  "/user/preferences",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin" , "staff"],
  }),
  getLoggedTenantUserPreferencesController,
);

Router.put(
  "/user/preferences",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin" , "staff"],
  }),
  updateLoggedTenantUserPreferencesController,
);

Router.put(
  "/user/profile",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin" , "staff"],
  }),
  updateLoggedTenantProfileController,
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
    roles: ["tenant_admin" , "staff"],
  }),
  getAllTenantUsersController,
);

Router.get(
  "/user/:tenant_user_id",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin" , "staff"],
  }),
  getTenantUserByIdController,
);

Router.put(
  "/user/:tenant_user_id",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin" , "staff"],
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
    roles: ["tenant_admin" , "staff"],
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

Router.post("/user/forgot-password", forgotTenantPasswordController);
Router.post("/user/verify-otp", verifyTenantOTPController);
Router.post("/user/reset-password", resetTenantPasswordController);

export default Router;
