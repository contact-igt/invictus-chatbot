import {
    createCampaignService,
    getCampaignListService,
    getCampaignByIdService,
    executeCampaignBatchService,
    softDeleteCampaignService,
    permanentDeleteCampaignService,
    getDeletedCampaignListService,
    restoreCampaignService,
} from "./whatsappcampaign.service.js";
import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import { uploadToCloudinary } from "../../middlewares/cloudinary/cloudinaryUpload.js";

// ... existing code ...

export const getDeletedCampaignListController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    try {
        const result = await getDeletedCampaignListService(tenant_id);
        return res.status(200).send({
            message: "success",
            data: result,
        });
    } catch (err) {
        return res.status(500).send({ message: err.message });
    }
};

export const restoreCampaignController = async (req, res) => {
    const { campaign_id } = req.params;
    const tenant_id = req.user.tenant_id;
    try {
        const result = await restoreCampaignService(campaign_id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        if (err.message === "Campaign not found or not deleted") {
            return res.status(404).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};

export const createCampaignController = async (req, res) => {
    const tenant_id = req.user.tenant_id;
    const created_by = req.user.unique_id || "system";

    try {
        const { campaign_name, campaign_type, template_id, audience_type, audience_data } = req.body;

        const requiredFields = {
            campaign_name,
            campaign_type,
            template_id,
            audience_type,
            audience_data,
        };

        const missingFields = await missingFieldsChecker(requiredFields);
        if (missingFields.length > 0) {
            return res.status(400).send({
                message: `Missing required field(s): ${missingFields.join(", ")}`,
            });
        }

        if (campaign_type === "scheduled" && !req.body.scheduled_at) {
            return res.status(400).send({
                message: "scheduled_at is required for scheduled campaigns",
            });
        }

        const campaign = await createCampaignService(tenant_id, req.body, created_by);

        return res.status(200).send({
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
        const campaign = await getCampaignByIdService(campaign_id, tenant_id, req.query);
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

export const softDeleteCampaignController = async (req, res) => {
    const { campaign_id } = req.params;
    const tenant_id = req.user.tenant_id;
    try {
        const result = await softDeleteCampaignService(campaign_id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        if (err.message === "Campaign not found") {
            return res.status(404).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};

export const permanentDeleteCampaignController = async (req, res) => {
    const { campaign_id } = req.params;
    const tenant_id = req.user.tenant_id;
    try {
        const result = await permanentDeleteCampaignService(campaign_id, tenant_id);
        return res.status(200).send(result);
    } catch (err) {
        if (err.message === "Campaign not found") {
            return res.status(404).send({ message: err.message });
        }
        return res.status(500).send({ message: err.message });
    }
};

export const uploadCampaignMediaController = async (req, res) => {
    try {
        if (!req.files || !req.files.media) {
            return res.status(400).send({ message: "No media file uploaded" });
        }

        const file = req.files.media;
        const type = req.body.type || "image"; // image, video, document

        // Resource type for Cloudinary
        let resourceType = "image";
        if (type === "video") resourceType = "video";
        if (type === "document") resourceType = "raw";

        const imageUrl = await uploadToCloudinary(file, resourceType, "public", "campaigns");

        return res.status(200).send({
            message: "Media uploaded successfully",
            url: imageUrl,
        });
    } catch (err) {
        console.error("Upload error:", err);
        return res.status(500).send({ message: err.message });
    }
};
