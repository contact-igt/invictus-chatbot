import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  getTenantDynamicAccessController,
  getTenantDynamicNavigationController,
} from "./moduleAccess.controller.js";

const Router = express.Router();

Router.get(
  "/dynamic-access",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "staff"],
  }),
  getTenantDynamicAccessController,
);

Router.get(
  "/dynamic-navigation",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "staff"],
  }),
  getTenantDynamicNavigationController,
);

export default Router;
