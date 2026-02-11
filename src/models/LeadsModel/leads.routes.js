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
  "/leads-summary/:lead_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getLeadSummaryController,
);
Router.put(
  "/lead/:lead_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateLeadController,
);
Router.post(
  "/lead/:lead_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreLeadController,
);
Router.delete(
  "/lead/:lead_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  deleteLeadController,
);


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

Router.delete(
  "/lead/:lead_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteLeadController,
);

export default Router;
