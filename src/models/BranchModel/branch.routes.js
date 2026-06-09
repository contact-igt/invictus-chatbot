import express from "express";
import {
  createBranchController,
  getBranchByIdController,
  getBranchListController,
  updateBranchController,
} from "./branch.controller.js";
import {
  getBranchDoctorsController,
  addDoctorsToBranchController,
  removeDoctorFromBranchController,
} from "../DoctorModel/doctorBranch.controller.js";
import {
  getDeletedBranchesController,
  permanentDeleteBranchController,
  restoreBranchController,
  softDeleteBranchController,
} from "./branch.lifecycle.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { checkFeatureAccess } from "../../middlewares/feature/checkFeatureAccess.js";

const Router = express.Router();
const tenantRoles = ["tenant_admin", "staff"];

Router.post(
  "/branch",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  createBranchController,
);

Router.get(
  "/branches",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  getBranchListController,
);

Router.get(
  "/branches/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  getDeletedBranchesController,
);

Router.get(
  "/branch/:branch_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  getBranchByIdController,
);

Router.put(
  "/branch/:branch_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  updateBranchController,
);

// Get doctors mapped to a branch
Router.get(
  "/branch/:branch_id/doctors",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  getBranchDoctorsController,
);

// Add one or more doctors to a branch (idempotent)
Router.post(
  "/branch/:branch_id/doctors",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  addDoctorsToBranchController,
);

// Remove doctor from branch
Router.delete(
  "/branch/:branch_id/doctors/:doctor_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  removeDoctorFromBranchController,
);

Router.delete(
  "/branch/:branch_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  softDeleteBranchController,
);

Router.post(
  "/branch/:branch_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  restoreBranchController,
);

Router.delete(
  "/branch/:branch_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  checkFeatureAccess("branches"),
  permanentDeleteBranchController,
);

export default Router;
