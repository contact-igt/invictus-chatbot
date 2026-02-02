import {
    createCampaignService,
    getCampaignListService,
    getCampaignByIdService,
    executeCampaignBatchService,
} from "./whatsappcampaign.service.js";

export const createCampaignController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const created_by = req.user.user_id || "system";

    try {
        const campaign = await createCampaignService(tenant_id, req.body, created_by);
        return res.status(201).send({
            message: "Campaign created successfully",
            campaign,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const getCampaignListController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    try {
        const data = await getCampaignListService(tenant_id, req.query);
        return res.status(200).send({
            message: "Success",
            data,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const getCampaignByIdController = async (req, res) => {
    const { campaign_id } = req.params;
    const tenant_id = req.user.tenant_id;
    try {
        const campaign = await getCampaignByIdService(campaign_id, tenant_id);
        if (!campaign) {
            return res.status(404).send({ message: "Campaign not found" });
        }
        return res.status(200).send({
            message: "Success",
            data: campaign,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const triggerCampaignExecutionController = async (req, res) => {
    const { campaign_id } = req.params;
    const tenant_id = req.user.tenant_id;
    try {
        const result = await executeCampaignBatchService(campaign_id, tenant_id);
        return res.status(200).send({
            message: result.finished ? "Campaign already completed" : "Batch execution started",
            result,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};
