import express from "express";
import {
  deleteManagmentByIdController,
  getManagementByIdController,
  getManagementController,
  getLoggedManagementController,
  loginManagementController,
  registerManagementController,
  softDeleteManagementController,
  updateManagementController,
  forgotManagementPasswordController,
  verifyManagementOTPController,
  resetManagementPasswordController,
  getDeletedManagementListController,
  restoreManagementController,
} from "./management.controller.js";
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
  "/list",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getManagementController,
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
    roles: ["super_admin"],
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


Router.post(
  "/forgot-password",
  forgotManagementPasswordController,
);


Router.post("/verify-otp", verifyManagementOTPController);
Router.post("/reset-password", resetManagementPasswordController);

export default Router;
