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
  // authenticateManagementToken,
  authenticateSuperAdminToken,
  // refreshToken,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post(
  "/management/register",
  // authenticateSuperAdminToken,
  registerManagementController
);
Router.post("/management/login", loginManagementController);
Router.get("/managements", getManagementController);
Router.get("/management/:id", getManagementByIdController);
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
// Router.post("/refresh-management-token", refreshToken);

export default Router;
