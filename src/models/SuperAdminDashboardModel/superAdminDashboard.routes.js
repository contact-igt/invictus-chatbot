import express from "express";
import { getSuperAdminDashboardController } from "./superAdminDashboard.controller.js";
import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

/**
 * GET /api/management/dashboard
 * Super Admin & Platform Admin dashboard — platform-wide statistics.
 */
Router.get(
    "/dashboard",
    authenticate,
    authorize({
        user_type: "management",
        roles: ["super_admin", "platform_admin"],
    }),
    getSuperAdminDashboardController
);

export default Router;
