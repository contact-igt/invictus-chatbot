import express from "express";
import {
  deleteManagmentByIdController,
  getManagementByIdController,
  getManagementController,
  loginManagementController,
  registerManagementController,
  updateDeleteStatusByIdController,
  updateManagementController,
} from "./management.controller.js";
import {
  authenticate,
  authorize,
  refreshToken,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post(
  "/management/register",
  authenticate,
  authorize({ user_type: "management", roles: ["super_admin" ] }),
  registerManagementController,
);

Router.post("/management/login", loginManagementController);

Router.get(
  "/managements",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getManagementController,
);

Router.get(
  "/management/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getManagementByIdController,
);

Router.put(
  "/management/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  updateManagementController,
);

Router.post("/management/refresh-token", refreshToken);

Router.put(
  "/management-delete/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  updateDeleteStatusByIdController,
);

Router.delete(
  "/management/:id",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin"],
  }),
  deleteManagmentByIdController,
);

export default Router;
