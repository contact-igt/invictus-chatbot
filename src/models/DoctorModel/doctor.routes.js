import express from "express";
import {
    createDoctorController,
    getDoctorListController,
    getDoctorByIdController,
    updateDoctorController,
    softDeleteDoctorController,
    permanentDeleteDoctorController,
    restoreDoctorController,
    getDeletedDoctorListController,
} from "./doctor.controller.js";
import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];
const managerRoles = ["tenant_admin", "staff"];

// Create doctor
Router.post(
    "/doctor",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    createDoctorController,
);

// List doctors (search + specialization filter + pagination)
Router.get(
    "/doctors",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    getDoctorListController,
);

// Deleted doctors list
Router.get(
    "/doctors/deleted/list",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    getDeletedDoctorListController,
);

// Get doctor by ID
Router.get(
    "/doctor/:id",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    getDoctorByIdController,
);

// Update doctor
Router.put(
    "/doctor/:id",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    updateDoctorController,
);

// Soft delete
Router.delete(
    "/doctor/:id/soft",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    softDeleteDoctorController,
);

// Permanent delete
Router.delete(
    "/doctor/:id/permanent",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
    permanentDeleteDoctorController,
);

// Restore
Router.post(
    "/doctor/:id/restore",
    authenticate,
    authorize({ user_type: "tenant", roles: managerRoles }),
    restoreDoctorController,
);

export default Router;
