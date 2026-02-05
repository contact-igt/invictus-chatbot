import express from "express";
import {
    authenticate,
    authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
    createCampaignController,
    getCampaignListController,
    getCampaignByIdController,
    triggerCampaignExecutionController,
    softDeleteCampaignController,
    permanentDeleteCampaignController,
} from "./whatsappcampaign.controller.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

router.post(
    "/whatsapp-campaign",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    createCampaignController,
);

router.get(
    "/whatsapp-campaign/list",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    getCampaignListController,
);

router.get(
    "/whatsapp-campaign/:campaign_id",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    getCampaignByIdController,
);

router.post(
    "/whatsapp-campaign/:campaign_id/execute",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    triggerCampaignExecutionController,
);

router.delete(
    "/whatsapp-campaign/:campaign_id/soft",
    authenticate,
    authorize({ user_type: "tenant", roles: tenantRoles }),
    softDeleteCampaignController
);

router.delete(
    "/whatsapp-campaign/:campaign_id/permanent",
    authenticate,
    authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
    permanentDeleteCampaignController
);

export default router;
