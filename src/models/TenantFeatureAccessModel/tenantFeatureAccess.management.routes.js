import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  getManagementTenantFeaturesController,
  patchManagementTenantFeaturesController,
} from "./tenantFeatureAccess.controller.js";

const Router = express.Router();

Router.get(
  "/tenant/:tenantId/features",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  getManagementTenantFeaturesController,
);

Router.patch(
  "/tenant/:tenantId/features",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
  patchManagementTenantFeaturesController,
);

export default Router;
