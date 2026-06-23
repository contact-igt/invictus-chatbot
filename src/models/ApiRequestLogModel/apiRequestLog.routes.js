import express from "express";

import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";
import { getApiRequestLogsController } from "./apiRequestLog.controller.js";

const Router = express.Router();

Router.get(
  "/api-request-logs",
  authenticate,
  authorize({
    user_type: "management",
    roles: ["super_admin", "platform_admin"],
  }),
  getApiRequestLogsController,
);

export default Router;
