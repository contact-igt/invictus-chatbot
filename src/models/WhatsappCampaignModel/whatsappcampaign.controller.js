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

    console.log(
      `[CAMPAIGN-CREATE] Campaign ${campaign.campaign_id} created with status=${campaign.status}, type=${campaign_type}, template_id=${template_id}`,
    );

    // For immediate send campaigns (not scheduled), kick off the first batch only.
    // The scheduler cron picks up remaining batches every minute — no tight loop here.
    if (campaign_type !== "scheduled") {
      console.log(
        `[CAMPAIGN-CREATE] Triggering immediate execution for campaign ${campaign.campaign_id}`,
      );
      setImmediate(async () => {
        console.log(
          `[CAMPAIGN-IMMEDIATE] setImmediate fired for campaign ${campaign.campaign_id}`,
        );
        try {
          const result = await executeCampaignBatchService(
            campaign.campaign_id,
            tenant_id,
            15,
          );
          console.log(
            `[CAMPAIGN-IMMEDIATE] Batch result for ${campaign.campaign_id}:`,
            JSON.stringify(result),
          );
        } catch (err) {
          console.error(
            `[Campaign Immediate Exec] Error for campaign ${campaign.campaign_id}:`,
            err.message,
            err.stack,
          );
        }
      });
    } else {
      console.log(
        `[CAMPAIGN-CREATE] Scheduled campaign ${campaign.campaign_id} — will execute at ${req.body.scheduled_at}`,
      );
    }

    return res.status(200).send({
      message: "Campaign created successfully",
      campaign,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const updateCampaignStatusController = async (req, res) => {
  const { campaign_id } = req.params;
  const tenant_id = req.user.tenant_id;
  const { status } = req.body;
  const acted_by =
    req.user.unique_id || req.user.email || req.user.user_id || "unknown";

  if (!status) {
    return res.status(400).json({
      success: false,
      error_code: "MISSING_STATUS",
      message: "status is required",
    });
  }

  try {
    const result = await updateCampaignStatusService(
      campaign_id,
      tenant_id,
      status,
      acted_by,
    );
    return res.status(200).json({
      success: true,
      message: "Campaign status updated",
      data: result,
    });
  } catch (err) {
    if (err.message === "Campaign not found") {
      return res.status(404).json({
        success: false,
        error_code: "CAMPAIGN_NOT_FOUND",
        message: err.message,
      });
    }
    if (err.message.includes("Invalid status transition")) {
      return res.status(422).json({
        success: false,
        error_code: "INVALID_STATUS_TRANSITION",
        message: err.message,
      });
    }
    return res.status(500).json({
      success: false,
      error_code: "CAMPAIGN_STATUS_UPDATE_FAILED",
      message: err.message,
    });
  }
};

export const campaignEventWebhookController = async (req, res) => {
  try {
    const result = await recordCampaignEventService(req.body || {});
    return res.status(200).json({
      success: true,
      message: "Event recorded",
      data: result,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error_code: "INVALID_CAMPAIGN_EVENT",
      message: err.message,
    });
  }
};

export const getCampaignStatsController = async (req, res) => {
  const { campaign_id } = req.params;
  const tenant_id = req.user.tenant_id;
  try {
    const stats = await getCampaignStatsService(campaign_id, tenant_id);
    return res.status(200).json({
      success: true,
      message: "Campaign stats fetched",
      data: stats,
    });
  } catch (err) {
    if (err.message === "Campaign not found") {
      return res.status(404).json({
        success: false,
        error_code: "CAMPAIGN_NOT_FOUND",
        message: err.message,
      });
    }
    return res.status(500).json({
      success: false,
      error_code: "CAMPAIGN_STATS_FETCH_FAILED",
      message: err.message,
    });
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
    const campaign = await getCampaignByIdService(
      campaign_id,
      tenant_id,
      req.query,
    );
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

export const exportCampaignRecipientsCsvController = async (req, res) => {
  const { campaign_id } = req.params;
  const tenant_id = req.user.tenant_id;
  const { recipient_status } = req.query;

  try {
    const result = await exportCampaignRecipientsCsvService(
      campaign_id,
      tenant_id,
      recipient_status,
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${result.fileName}"`,
    );

    return res.status(200).send(result.csv);
  } catch (err) {
    if (err.message === "Campaign not found") {
      return res.status(404).send({ message: err.message });
    }
    return res.status(500).send({ message: err.message });
  }
};

export const triggerCampaignExecutionController = async (req, res) => {
  const { campaign_id } = req.params;
  const tenant_id = req.user.tenant_id;
  const { default: db } = await import("../../database/index.js");

  const campaign = await db.WhatsappCampaigns.findOne({
    where: { campaign_id, tenant_id, is_deleted: false },
    attributes: ["campaign_id", "status"],
  });

  if (!campaign) {
    return res.status(404).send({ message: "Campaign not found" });
  }

  if (["completed", "cancelled"].includes(campaign.status)) {
    return res.status(422).send({
      message: `Campaign cannot be executed from ${campaign.status} state`,
    });
  }

  if (campaign.status === "paused") {
    return res.status(422).send({
      message: "Paused campaigns must be resumed before execution.",
    });
  }

  if (campaign.status !== "active") {
    await campaign.update({ status: "active" });
  }

  // Fire-and-forget: respond immediately, run batch in background
  setImmediate(async () => {
    try {
      await executeCampaignBatchService(campaign_id, tenant_id, 15);
    } catch (err) {
      console.error(
        `[Campaign Trigger] Error for campaign ${campaign_id}:`,
        err.message,
      );
    }
  });
  return res.status(202).send({ message: "Batch execution triggered" });
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
  const tenant_id = req.user?.tenant_id;
  const userId =
    req.user?.unique_id || req.user?.tenant_user_id || req.user?.id;
  try {
    if (!tenant_id) {
      return res.status(400).json({ message: "Invalid tenant context" });
    }
    if (!req.files || !req.files.media) {
      return res.status(400).json({ message: "No media file uploaded" });
    }

    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      return res.status(400).json({ message: "WhatsApp account not active" });
    }

    const media = await uploadMediaService(
      req.files.media,
      tenant_id,
      userId,
      whatsappAccount.access_token,
      whatsappAccount.app_id || process.env.META_APP_ID,
      { folder: "campaign-header", tags: ["campaign"] },
    );

    return res.status(200).json({
      message: "Media uploaded successfully",
      url: media.preview_url,
      media_handle: media.media_handle,
      media_asset_id: media.media_asset_id,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};
