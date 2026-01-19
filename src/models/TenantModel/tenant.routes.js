import express from "express";
import {
  createTenantController,
  deleteTenantController,
  getAllTenantController,
  getTenantByIdController,
  updateTenantController,
  updateTenantStatusController,
} from "./tenant.controller.js";
import {
  authenticate,
  requireSuperAdmin,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get("/tenants", authenticate, requireSuperAdmin, getAllTenantController);
Router.get(
  "/tenant/:id",
  authenticate,
  requireSuperAdmin,
  getTenantByIdController,
);
Router.post("/tenant",  createTenantController);
Router.put(
  "/tenant/:id",
  authenticate,
  requireSuperAdmin,
  updateTenantController,
);
Router.put(
  "/tenant-status/:id",
  authenticate,
  requireSuperAdmin,
  updateTenantStatusController,
);
Router.delete(
  "/tenant/:id",
  authenticate,
  requireSuperAdmin,
  deleteTenantController,
);

export default Router;
