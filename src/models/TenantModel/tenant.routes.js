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

Router.get("/tenants", getAllTenantController);
Router.get("/tenant/:id", getTenantByIdController);
Router.post("/tenant", authenticate, requireSuperAdmin, createTenantController);
Router.put("/tenant/:id", updateTenantController);
Router.put("/tenant-status/:id", updateTenantStatusController);
Router.delete("/tenant/:id", deleteTenantController);

export default Router;
