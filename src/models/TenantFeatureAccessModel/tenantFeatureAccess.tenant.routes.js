import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { getTenantFeaturesController } from "./tenantFeatureAccess.controller.js";

const Router = express.Router();

Router.get(
  "/features",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  getTenantFeaturesController,
);

export default Router;
