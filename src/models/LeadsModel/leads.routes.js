import express from "express";
import {
  deleteLeadController,
  permanentDeleteLeadController,
  getLeadListController,
  getLeadSummaryController,
  updateLeadController,
  getDeletedLeadListController,
  restoreLeadController,
} from "./leads.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];


Router.get(
  "/leads",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getLeadListController,
);
Router.get(
  "/leads/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getDeletedLeadListController,
);
Router.get(
  "/leads-summary/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getLeadSummaryController,
);
Router.put(
  "/lead/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateLeadController,
);
Router.post(
  "/lead/:id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreLeadController,
);
Router.delete(
  "/lead/:id",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  deleteLeadController,
);
Router.delete(
  "/lead/:id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteLeadController,
);

export default Router;
