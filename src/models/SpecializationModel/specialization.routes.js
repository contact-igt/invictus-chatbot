import express from "express";
import {
    createSpecializationController,
    getAllSpecializationsController,
    getSpecializationByIdController,
    updateSpecializationController,
    deleteSpecializationController,
    toggleActiveStatusController,
    getDeletedSpecializationListController,
    restoreSpecializationController,
    permanentDeleteSpecializationController,
} from "./specialization.controller.js";
import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];
const managerRoles = ["tenant_admin", "staff"];

// List all specializations (all roles can view)
Router.get(
    "/specializations",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    getAllSpecializationsController,
);

// Get deleted specializations (admin + staff)
Router.get(
    "/specializations/deleted",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    getDeletedSpecializationListController,
);

// Restore specialization (admin only)
Router.patch(
    "/specialization/:id/restore",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
    restoreSpecializationController,
);

// Permanent delete specialization (admin only)
Router.delete(
    "/specialization/:id/permanent",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
    permanentDeleteSpecializationController,
);

// Get specialization by ID
Router.get(
    "/specialization/:id",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    getSpecializationByIdController,
);

// Create specialization (admin + staff)
Router.post(
    "/specialization",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    createSpecializationController,
);

// Update specialization (admin + staff)
Router.put(
    "/specialization/:id",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    updateSpecializationController,
);

// Toggle active status (admin + staff)
Router.patch(
    "/specialization/:id/status",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    toggleActiveStatusController,
);

// Delete specialization (admin only)
Router.delete(
    "/specialization/:id",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
    deleteSpecializationController,
);

export default Router;
