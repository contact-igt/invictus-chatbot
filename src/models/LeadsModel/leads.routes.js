import express from "express";
import {
  getLeadListController,
  getLeadSummaryController,
  updateLeadController,
  getBulkLeadSummaryController,
  getLeadByIdController,
  bulkUpdateLeadsController,
} from "./leads.controller.js";
import {
  softDeleteLeadController,
  hardDeleteLeadController,
  restoreLeadController,
  getDeletedLeadsController,
} from "./leads.lifecycle.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { requireAiAccess } from "../../middlewares/billing/billingAccessGuard.js";

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

Router.put(
  "/leads/bulk-update",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  bulkUpdateLeadsController,
);

Router.get(
  "/leads-summary/:lead_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  requireAiAccess,
  getLeadSummaryController,
);

Router.post(
  "/lead-summary-bulk",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  requireAiAccess,
  getBulkLeadSummaryController,
);

Router.delete(
  "/lead/:lead_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  softDeleteLeadController,
);

Router.get(
  "/leads/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getDeletedLeadsController,
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
  hardDeleteLeadController,
);

export default Router;
