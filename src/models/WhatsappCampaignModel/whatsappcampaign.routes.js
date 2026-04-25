import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { requireCampaignAccess } from "../../middlewares/billing/billingAccessGuard.js";
import {
  createCampaignController,
  getCampaignListController,
  getCampaignByIdController,
  exportCampaignRecipientsCsvController,
  triggerCampaignExecutionController,
  estimateCampaignCostController,
  updateCampaignStatusController,
  campaignEventWebhookController,
  getCampaignStatsController,
  uploadCampaignMediaController,
} from "./whatsappcampaign.controller.js";
import {
  softDeleteCampaignController,
  hardDeleteCampaignController,
  restoreCampaignController,
  getDeletedCampaignsController,
} from "./whatsappcampaign.lifecycle.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

router.post(
  "/whatsapp-campaign",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createCampaignController,
);

router.post(
  "/whatsapp-campaign/estimate-cost",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  estimateCampaignCostController,
);

router.get(
  "/whatsapp-campaign/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getCampaignListController,
);

router.post(
  "/whatsapp-campaign/upload-media",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  uploadCampaignMediaController,
);

router.get(
  "/whatsapp-campaign",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getCampaignListController,
);

router.get(
  "/whatsapp-campaign/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getDeletedCampaignsController,
);

router.get(
  "/whatsapp-campaign/:campaign_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getCampaignByIdController,
);

router.get(
  "/whatsapp-campaign/:campaign_id/export",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  exportCampaignRecipientsCsvController,
);

router.post(
  "/whatsapp-campaign/:campaign_id/execute",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  requireCampaignAccess,
  triggerCampaignExecutionController,
);

router.post(
  "/whatsapp-campaign/:campaign_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreCampaignController,
);

router.patch(
  "/whatsapp-campaign/:campaign_id/status",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateCampaignStatusController,
);
router.post(
  "/whatsapp-campaign/:campaign_id/status",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateCampaignStatusController,
);
router.patch(
  "/whatsapp-campaign/:id/status",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  (req, _res, next) => {
    req.params.campaign_id = req.params.id;
    next();
  },
  updateCampaignStatusController,
);
router.post(
  "/whatsapp-campaign/:id/status",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  (req, _res, next) => {
    req.params.campaign_id = req.params.id;
    next();
  },
  updateCampaignStatusController,
);

router.post("/whatsapp-campaign/event", campaignEventWebhookController);

router.get(
  "/whatsapp-campaign/:campaign_id/stats",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getCampaignStatsController,
);

router.delete(
  "/whatsapp-campaign/:campaign_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  softDeleteCampaignController,
);

router.delete(
  "/whatsapp-campaign/:campaign_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  hardDeleteCampaignController,
);

// REST aliases (v1 contract friendly)
router.post(
  "/campaigns",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createCampaignController,
);
router.get(
  "/campaigns",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getCampaignListController,
);
router.get(
  "/campaigns/:campaign_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getCampaignByIdController,
);
router.patch(
  "/campaigns/:campaign_id/status",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateCampaignStatusController,
);
router.post(
  "/campaigns/:campaign_id/status",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateCampaignStatusController,
);
router.delete(
  "/campaigns/:campaign_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  softDeleteCampaignController,
);

export default router;
