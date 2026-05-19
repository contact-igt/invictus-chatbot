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

// [DOCTOR ROLE UNWIRED – 2026-05-13] "doctor" removed from all tenant route access.
const tenantRoles = ["tenant_admin", /* "doctor", */ "staff"];

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
