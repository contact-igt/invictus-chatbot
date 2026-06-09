import express from "express";
import {
  playgroundChat,
  playgroundInbound,
  getPlaygroundKnowledgeSources,
} from "./playground.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { requireAiAccess } from "../../middlewares/billing/billingAccessGuard.js";

const Router = express.Router();
const tenantRoles = ["tenant_admin", "staff"];

Router.post(
  "/playground/chat",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  requireAiAccess,
  playgroundChat,
);

Router.post(
  "/playground/inbound",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  requireAiAccess,
  playgroundInbound,
);

Router.get(
  "/playground/knowledge-sources",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getPlaygroundKnowledgeSources,
);

export default Router;

