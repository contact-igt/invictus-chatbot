import express from "express";
import {
  playgroundChat,
  getPlaygroundKnowledgeSources,
} from "./playground.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { requireAiAccess } from "../../middlewares/billing/billingAccessGuard.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

Router.post(
  "/playground/chat",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  requireAiAccess,
  playgroundChat,
);

Router.get(
  "/playground/knowledge-sources",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getPlaygroundKnowledgeSources,
);

export default Router;
