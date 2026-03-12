import express from "express";
import { getDashboardController } from "./dashboard.controller.js";
import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

/**
 * GET Dashboard Statistics
 * Endpoint: /api/whatsapp/dashboard
 * Protected: Requires Auth + Tenant-level Access
 */
Router.get(
    "/dashboard",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin", "doctor", "staff", "agent"] }),
    getDashboardController
);

export default Router;
