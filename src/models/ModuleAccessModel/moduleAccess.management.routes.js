import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  listIndustriesController,
  createIndustryController,
  patchIndustryController,
  listSaaSModulesController,
  createSaaSModuleController,
  patchSaaSModuleController,
  listPlansController,
  createPlanController,
  patchPlanController,
  getIndustrySaaSModulesController,
  patchIndustrySaaSModulesController,
  getPlanSaaSModulesController,
  patchPlanSaaSModulesController,
  getManagementTenantDynamicAccessController,
  patchManagementTenantDynamicAccessController,
} from "./moduleAccess.management.controller.js";

const Router = express.Router();

const managementAuth = [
  authenticate,
  authorize({
    user_type: "management",
    roles: ["platform_admin", "super_admin"],
  }),
];

Router.get("/industries", ...managementAuth, listIndustriesController);
Router.post("/industries", ...managementAuth, createIndustryController);
Router.patch("/industries/:industryId", ...managementAuth, patchIndustryController);

Router.get("/saas-modules", ...managementAuth, listSaaSModulesController);
Router.post("/saas-modules", ...managementAuth, createSaaSModuleController);
Router.patch("/saas-modules/:moduleId", ...managementAuth, patchSaaSModuleController);

Router.get("/plans", ...managementAuth, listPlansController);
Router.post("/plans", ...managementAuth, createPlanController);
Router.patch("/plans/:planId", ...managementAuth, patchPlanController);

Router.get(
  "/industries/:industryId/saas-modules",
  ...managementAuth,
  getIndustrySaaSModulesController,
);
Router.patch(
  "/industries/:industryId/saas-modules",
  ...managementAuth,
  patchIndustrySaaSModulesController,
);

Router.get(
  "/plans/:planId/saas-modules",
  ...managementAuth,
  getPlanSaaSModulesController,
);
Router.patch(
  "/plans/:planId/saas-modules",
  ...managementAuth,
  patchPlanSaaSModulesController,
);

Router.get(
  "/tenants/:tenantId/dynamic-access",
  ...managementAuth,
  getManagementTenantDynamicAccessController,
);
Router.patch(
  "/tenants/:tenantId/dynamic-access",
  ...managementAuth,
  patchManagementTenantDynamicAccessController,
);

export default Router;
