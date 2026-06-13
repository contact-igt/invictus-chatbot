import {
  createCampaignService,
  getCampaignListService,
  getCampaignByIdService,
  exportCampaignRecipientsCsvService,
  executeCampaignBatchService,
  softDeleteCampaignService,
  permanentDeleteCampaignService,
  getDeletedCampaignListService,
  restoreCampaignService,
  updateCampaignStatusService,
  recordCampaignEventService,
  getCampaignStatsService,
  resolveRecipientCount,
} from "./whatsappcampaign.service.js";
import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import { checkBillingAccess } from "../../middlewares/billing/billingAccessGuard.js";
import { estimateMetaCost } from "../../utils/billing/costEstimator.js";
import { uploadMediaService } from "../GalleryModel/gallery.service.js";
import { getWhatsappAccountByTenantService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { hasSecret } from "../TenantSecretsModel/tenantSecrets.service.js";
import { getCampaignDiagnosticsService } from "../../services/campaignDiagnostics.service.js";
import {
  isCampaignQueueAvailable,
  getCampaignDispatchQueue,
} from "../../queues/campaignQueue.js";

/**
 * GET /whatsapp-campaign/estimate-cost
 * Returns estimated cost for a campaign given template_id and recipient_count.
 */
export const estimateCampaignCostController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { template_id, recipient_count } = req.body;

  try {
    const recipientCount = parseInt(recipient_count, 10) || 1;

    // Look up template category
    const { default: db } = await import("../../database/index.js");
    const template = await db.WhatsappTemplates.findOne({
      where: { template_id },
      attributes: ["category"],
      raw: true,
    });
    const category = (template?.category || "marketing").toLowerCase();

    // Look up tenant's country and phone code
    const tenant = await db.Tenants.findOne({
      where: { tenant_id },
      attributes: ["country", "owner_country_code", "timezone"],
      raw: true,
    });

    // Auto-detect India based on timezone or country code
    const isIndia =
      tenant?.owner_country_code === "91" ||
      tenant?.timezone === "Asia/Kolkata";
    const country =
      req.body.country || tenant?.country || (isIndia ? "IN" : "Global");

    // Get cost per message
    const cost = await estimateMetaCost(category, country);
    const perMessageCostInr = cost.totalCostInr;
    const totalCostInr = perMessageCostInr * recipientCount;

    // Get wallet balance for comparison
    const wallet = await db.Wallets.findOne({
      where: { tenant_id },
      attributes: ["balance"],
      raw: true,
    });
    const walletBalance = wallet ? parseFloat(wallet.balance) || 0 : 0;

    return res.status(200).json({
      success: true,
      category,
      recipient_count: recipientCount,
      per_message_cost_inr: perMessageCostInr,
      total_cost_inr: totalCostInr,
      wallet_balance: walletBalance,
      is_sufficient: walletBalance >= totalCostInr,
      shortfall: Math.max(0, totalCostInr - walletBalance),
      base_rate_usd: cost.baseRate,
      markup_percent: cost.markupPercent,
      conversion_rate: cost.conversionRate,
    });
  } catch (err) {
    console.error("[CAMPAIGN-ESTIMATE] Error:", err.message);
    return res.status(500).json({ message: err.message });
  }
};

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
    const {
      campaign_name,
      campaign_type,
      template_id,
      audience_type,
      audience_data,
    } = req.body;

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

    // Verify WhatsApp access token exists before allowing campaign creation
    const hasWhatsAppToken = await hasSecret(tenant_id, "whatsapp");
    if (!hasWhatsAppToken) {
      console.error(
        `[CAMPAIGN-CREATE] WhatsApp access token not found for tenant ${tenant_id}`,
      );
      return res.status(400).send({
        success: false,
        message:
          "WhatsApp is not configured. Please complete WhatsApp setup in Settings before creating campaigns.",
      });
    }

    // Validate scheduled_at is in the future (at least 1 minute ahead)
    if (campaign_type === "scheduled" && req.body.scheduled_at) {
      const scheduledTime = new Date(req.body.scheduled_at);
      const now = new Date();
      if (isNaN(scheduledTime.getTime())) {
        return res
          .status(400)
          .send({ message: "Invalid scheduled_at date format" });
      }
      if (scheduledTime.getTime() <= now.getTime() + 60_000) {
        return res.status(400).send({
          message: "Scheduled time must be at least 1 minute in the future",
        });
      }
      req.body.scheduled_at = scheduledTime.toISOString();
    }

    // Billing check: wallet must cover the estimated total cost for ALL campaign types,
    // including scheduled. If wallet is insufficient at creation time, block the campaign.
    // At scheduled execution time the wallet is checked again per-batch — if it has
    // dropped below cost by then, the campaign will be automatically paused.
    const recipientCount = await resolveRecipientCount(
      tenant_id,
      audience_type,
      audience_data,
    );
    if (recipientCount > 0) {
      try {
        // Get template category for cost estimation
        const { default: db } = await import("../../database/index.js");
        const template = await db.WhatsappTemplates.findOne({
          where: { template_id },
          attributes: ["category"],
          raw: true,
        });
        const category = (template?.category || "marketing").toLowerCase();

        // Look up tenant's country and timezone
        const tenant = await db.Tenants.findOne({
          where: { tenant_id },
          attributes: ["country", "owner_country_code", "timezone"],
          raw: true,
        });
        const isIndia =
          tenant?.owner_country_code === "91" ||
          tenant?.timezone === "Asia/Kolkata";
        const country =
          req.body.country || tenant?.country || (isIndia ? "IN" : "Global");

        const cost = await estimateMetaCost(category, country);
        const estimated_cost = cost.totalCostInr * recipientCount;

        const access = await checkBillingAccess(tenant_id, estimated_cost);
        if (!access.allowed) {
          return res.status(403).json({
            success: false,
            ...access,
            message: access.reason,
            recipient_count: recipientCount,
            estimated_cost,
          });
        }
      } catch (billingErr) {
        console.error(
          "[CAMPAIGN-CREATE] Billing check error:",
          billingErr.message,
        );
        // Fail open on billing check error — don't block campaign creation
      }
    }

    const campaign = await createCampaignService(
      tenant_id,
      req.body,
      created_by,
    );

    return res.status(201).json({
      success: true,
      message: "Campaign created successfully",
      campaign,
    });
  } catch (err) {
    console.error("[CAMPAIGN-CREATE] Error:", err.message);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to create campaign",
    });
  }
};

export const getCampaignListController = async (req, res) => {
  try {
    const result = await getCampaignListService(req.user.tenant_id, req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getCampaignByIdController = async (req, res) => {
  try {
    const campaign = await getCampaignByIdService(
      req.params.campaign_id,
      req.user.tenant_id,
      req.query,
    );
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }
    return res.status(200).json({ success: true, data: campaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const exportCampaignRecipientsCsvController = async (req, res) => {
  try {
    const result = await exportCampaignRecipientsCsvService(
      req.params.campaign_id,
      req.user.tenant_id,
      req.query?.recipient_status,
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.fileName}"`,
    );
    return res.status(200).send(result.csv);
  } catch (err) {
    const status = err.message === "Campaign not found" ? 404 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

export const triggerCampaignExecutionController = async (req, res) => {
  try {
    const batchSize = Number(req.body?.batch_size || req.query?.batch_size || 15);
    const result = await executeCampaignBatchService(
      req.params.campaign_id,
      req.user.tenant_id,
      batchSize,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCampaignStatusController = async (req, res) => {
  try {
    const status = req.body?.status || req.query?.status;
    if (!status) {
      return res.status(400).json({ success: false, message: "status is required" });
    }
    const result = await updateCampaignStatusService(
      req.user.tenant_id,
      req.params.campaign_id,
      status,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const campaignEventWebhookController = async (req, res) => {
  try {
    const result = await recordCampaignEventService(req.body || {});
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getCampaignStatsController = async (req, res) => {
  try {
    const result = await getCampaignStatsService(
      req.user.tenant_id,
      req.params.campaign_id,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    const status = err.message === "Campaign not found" ? 404 : 500;
    return res.status(status).json({ success: false, message: err.message });
  }
};

export const uploadCampaignMediaController = async (req, res) => {
  try {
    const file = req.files?.file || req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "file is required" });
    }

    const account = await getWhatsappAccountByTenantService(req.user.tenant_id);
    const accessToken = account?.access_token;
    const appId = account?.app_id || process.env.META_APP_ID;
    if (!accessToken || !appId) {
      return res.status(400).json({
        success: false,
        message: "WhatsApp access token or Meta app id is missing",
      });
    }

    const media = await uploadMediaService(
      file,
      req.user.tenant_id,
      req.user.unique_id || "system",
      accessToken,
      appId,
      { folder: "campaigns" },
    );

    return res.status(201).json({ success: true, data: media });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getCampaignDiagnosticsController = async (_req, res) => {
  try {
    const result = await getCampaignDiagnosticsService();
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
