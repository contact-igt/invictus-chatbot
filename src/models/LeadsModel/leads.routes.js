import express from "express";
import {
  deleteLeadController,
  permanentDeleteLeadController,
  getLeadListController,
  getLeadSummaryController,
  updateLeadController,
  getDeletedLeadListController,
  restoreLeadController,
  getBulkLeadSummaryController,
  getLeadByIdController,
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
  "/lead/:lead_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getLeadByIdController,
);

Router.put(
  "/lead/:lead_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateLeadController,
);

Router.get(
  "/leads-summary/:lead_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getLeadSummaryController,
);

Router.post(
  "/lead-summary-bulk",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getBulkLeadSummaryController,
);


Router.delete(
  "/lead/:lead_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  deleteLeadController,
);


Router.get(
  "/leads/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getDeletedLeadListController,
);


Router.post(
  "/lead/:lead_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreLeadController,
);

Router.delete(
  "/lead/:lead_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteLeadController,
);



export default Router;
