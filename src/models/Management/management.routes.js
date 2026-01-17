import express from "express";
import {
  // deleteManagementByIdController,
  getManagementByIdController,
  getManagementController,
  loginManagementController,
  registerManagementController,
  // updateManagementByIdController,
  // userPasswordChange,
} from "./management.controller.js";
import {
  authenticate,
  refreshToken,
  // authenticateManagementToken,
  // authenticateSuperAdminToken,
  requireAdmin,
  requireManagement,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post(
  "/management/register",
  authenticate,
  requireAdmin,
  registerManagementController
);
Router.post("/management/login", loginManagementController);
Router.get(
  "/managements",
  authenticate,
  requireManagement,
  getManagementController
);
Router.get(
  "/management/:id",
  authenticate,
  requireManagement,
  getManagementByIdController
);




// Router.post("/management/user-password", userPasswordChange);
// Router.put(
//   "/management/:id",
//   authenticateManagementToken,
//   updateManagementByIdController
// );
// Router.delete(
//   "/management/:id",
//   authenticateSuperAdminToken,
//   deleteManagementByIdController
// );
Router.post("/refresh-management-token", refreshToken);

export default Router;
