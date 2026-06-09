import express from "express";
import {
  createDoctorController,
  getDoctorListController,
  getDoctorByIdController,
  updateDoctorController,
} from "./doctor.controller.js";
import {
  getDoctorBranchesController,
  replaceDoctorBranchesController,
} from "./doctorBranch.controller.js";
import {
  softDeleteDoctorController,
  hardDeleteDoctorController,
  restoreDoctorController,
  getDeletedDoctorsController,
} from "./doctor.lifecycle.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { checkFeatureAccess } from "../../middlewares/feature/checkFeatureAccess.js";

const Router = express.Router();

// [DOCTOR ROLE UNWIRED – 2026-05-13] "doctor" removed from all tenant route access.
// Re-enable by adding "doctor" back to the arrays below.
const tenantRoles = ["tenant_admin", /* "doctor", */ "staff"];
const managerRoles = ["tenant_admin", "staff"];

// Create doctor
Router.post(
  "/doctor",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  checkFeatureAccess("doctors"),
  createDoctorController,
);

// List doctors (search + specialization filter + pagination)
Router.get(
  "/doctors",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("doctors"),
  getDoctorListController,
);

// Deleted doctors list
Router.get(
  "/doctors/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  checkFeatureAccess("doctors"),
  getDeletedDoctorsController,
);

// Get doctor by ID
Router.get(
  "/doctor/:doctor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("doctors"),
  getDoctorByIdController,
);

// Get branches mapped to a doctor
Router.get(
  "/doctor/:doctor_id/branches",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("doctors"),
  getDoctorBranchesController,
);

// Update doctor
Router.put(
  "/doctor/:doctor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  checkFeatureAccess("doctors"),
  updateDoctorController,
);

// Replace doctor branch mappings (atomic)
Router.put(
  "/doctor/:doctor_id/branches",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  checkFeatureAccess("doctors"),
  replaceDoctorBranchesController,
);

// Soft delete
Router.delete(
  "/doctor/:doctor_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  checkFeatureAccess("doctors"),
  softDeleteDoctorController,
);

// Permanent delete
Router.delete(
  "/doctor/:doctor_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  checkFeatureAccess("doctors"),
  hardDeleteDoctorController,
);

// Restore
Router.post(
  "/doctor/:doctor_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: managerRoles }),
  checkFeatureAccess("doctors"),
  restoreDoctorController,
);

export default Router;
