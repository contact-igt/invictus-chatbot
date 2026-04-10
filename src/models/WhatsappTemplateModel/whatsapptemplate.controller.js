import { generateReadableIdFromLast } from "../../utils/helpers/generateReadableIdFromLast.js";
import { tableNames } from "../../database/tableName.js";
import { logger } from "../../utils/logger.js";
import {
  checkTemplateNameExistsOnMetaService,
  createWhatsappTemplateService,
  getTemplateByIdService,
  getTemplateListService,
  permanentDeleteTemplateService,
  pullTemplatesFromMetaService,
  softDeleteTemplateService,
  submitWhatsappTemplateService,
  syncAllPendingTemplatesService,
  syncWhatsappTemplateStatusService,
  updateWhatsappTemplateService,
  generateTemplateContentService,
  getDeletedTemplateListService,
  restoreTemplateService,
} from "./whatsapptemplate.service.js";
import { missingFieldsChecker } from "../../utils/helpers/missingFields.js";
import db from "../../database/index.js";
import { getWhatsappAccountByTenantService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { uploadMediaService } from "../GalleryModel/gallery.service.js";

export const getDeletedTemplateListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const data = await getDeletedTemplateListService(tenant_id);
    return res.status(200).send({
      message: "Success",
      data,
    });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
};

export const restoreTemplateController = async (req, res) => {
  const { template_id } = req.params;
  const tenant_id = req.user.tenant_id;
  try {
    const result = await restoreTemplateService(template_id, tenant_id);
    return res.status(200).send(result);
  } catch (err) {
    if (err.message === "Template not found or not deleted") {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: err.message });
    }
    logger.error("restoreTemplateController error:", err);
    return res.status(500).json({ success: false, error_code: "INTERNAL_ERROR", message: err.message });
  }
};
export const createWhatsappTemplateController = async (req, res) => {
  try {
    const loginUser = req.user;

    const {
      template_name,
      category,
      template_type,
      language,
      components,
      variables,
    } = req.body;

    const requiredFields = {
      template_name,
      category,
      template_type,
      components,
    };

    const missingFields = await missingFieldsChecker(requiredFields);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error_code: "MISSING_FIELD",
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    if (!components?.body?.text) {
      return res.status(400).json({
        success: false,
        error_code: "MISSING_FIELD",
        message: "Body component text is required",
      });
    }

    // Check if name exists on Meta
    const existsOnMeta = await checkTemplateNameExistsOnMetaService(
      loginUser?.tenant_id,
      template_name,
    );

    if (existsOnMeta) {
      return res.status(409).json({
        success: false,
        error_code: "DUPLICATE_TEMPLATE_NAME",
        message:
          "Template name already exists on Meta. Please use a different name or sync existing templates.",
      });
    }

    const template_id = await generateReadableIdFromLast(
      tableNames.WHATSAPP_TEMPLATE,
      "template_id",
      "WT",
    );

    await createWhatsappTemplateService(
      template_id,
      loginUser?.tenant_id,
      template_name,
      category,
      template_type,
      language,
      components,
      variables,
      loginUser?.unique_id,
    );

    return res.status(201).json({
      success: true,
      message: "WhatsApp template created successfully",
      data: {
        template_id,
        status: "draft",
      },
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY" || err.message?.includes("already exists")) {
      return res.status(409).json({
        success: false,
        error_code: "DUPLICATE_TEMPLATE_NAME",
        message: "A template with this name already exists.",
      });
    }
    logger.error("createWhatsappTemplateController error:", err);
    return res.status(500).json({
      success: false,
      error_code: "INTERNAL_ERROR",
      message: err.message,
    });
  }
};

export const submitWhatsappTemplateController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { template_id } = req.params;

    if (!tenant_id) {
      return res.status(401).json({ success: false, error_code: "UNAUTHORIZED", message: "Authentication required" });
    }

    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      return res.status(400).json({
        success: false,
        error_code: "WHATSAPP_ACCOUNT_INACTIVE",
        message: "WhatsApp account not active",
      });
    }

    const [[template]] = await db.sequelize.query(
      `
      SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE}
      WHERE template_id = ? AND tenant_id = ? AND is_deleted = false
      `,
      { replacements: [template_id, tenant_id] },
    );

    if (!template) {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: "Template not found" });
    }

    if (template.status !== "draft") {
      return res.status(422).json({
        success: false,
        error_code: "VALIDATION_ERROR",
        message: "Only draft templates can be submitted",
      });
    }

    // Components
    const [components] = await db.sequelize.query(
      `
      SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
      WHERE template_id = ?
      `,
      { replacements: [template_id] },
    );

    // Variables
    const [variables] = await db.sequelize.query(
      `
      SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
      WHERE template_id = ?
      ORDER BY variable_key ASC
      `,
      { replacements: [template_id] },
    );

    const result = await submitWhatsappTemplateService({
      template,
      components,
      variables,
      whatsappAccount,
    });

    return res.status(200).json({
      success: true,
      message: "Template submitted successfully",
      data: result,
    });
  } catch (err) {
    // Handle Meta "Template being deleted" error specifically
    if (
      err.metaError &&
      err.metaError.code === 100 &&
      err.metaError.error_subcode === 2388023
    ) {
      return res.status(409).json({
        success: false,
        error_code: "META_TEMPLATE_DELETION_PENDING",
        message:
          "This template name was recently deleted on Meta. Please wait approx. 1 minute before resubmitting, or use a different name.",
        meta_error: err.metaError,
      });
    }
    logger.error("submitWhatsappTemplateController error:", err);
    return res.status(500).json({
      success: false,
      error_code: "INTERNAL_ERROR",
      message: err.message,
    });
  }
};

export const syncWhatsappTemplateStatusController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { template_id } = req.params;

    if (!tenant_id) {
      return res.status(400).json({
        message: "Invalid tenant context",
      });
    }

    // WhatsApp account
    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      return res.status(400).json({
        message: "WhatsApp account not active",
      });
    }

    // Template
    const [[template]] = await db.sequelize.query(
      `
      SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE}
      WHERE template_id = ? AND tenant_id = ? AND is_deleted = false
      `,
      {
        replacements: [template_id, tenant_id],
      },
    );

    if (!template) {
      return res.status(404).json({
        message: "Template not found",
      });
    }

    const result = await syncWhatsappTemplateStatusService({
      template,
      whatsappAccount,
    });

    return res.status(200).json({
      message: "Template status synced successfully",
      data: result,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
};

export const syncAllWhatsappTemplatesController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;

    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      return res.status(400).json({
        message: "WhatsApp account not active",
      });
    }

    const result = await pullTemplatesFromMetaService(tenant_id);

    return res.status(200).json({
      message: "Templates synced successfully (Imported & Updated)",
      data: result,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const getTemplateListController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  try {
    const templates = await getTemplateListService(tenant_id);
    return res.status(200).json({
      success: true,
      message: "success",
      data: templates,
    });
  } catch (err) {
    logger.error("getTemplateListController error:", err);
    return res.status(500).json({ success: false, error_code: "INTERNAL_ERROR", message: err.message });
  }
};

export const getTemplateByIdController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { template_id } = req.params;
  try {
    const template = await getTemplateByIdService(template_id, tenant_id);
    if (!template) {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: "Template not found" });
    }
    return res.status(200).json({
      success: true,
      message: "success",
      data: template,
    });
  } catch (err) {
    logger.error("getTemplateByIdController error:", err);
    return res.status(500).json({ success: false, error_code: "INTERNAL_ERROR", message: err.message });
  }
};

export const softDeleteTemplateController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { template_id } = req.params;
  try {
    await softDeleteTemplateService(template_id, tenant_id);
    return res.status(200).json({
      success: true,
      message: "Template soft-deleted successfully",
    });
  } catch (err) {
    if (err.message?.includes("not found")) {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: err.message });
    }
    logger.error("softDeleteTemplateController error:", err);
    return res.status(500).json({ success: false, error_code: "INTERNAL_ERROR", message: err.message });
  }
};

export const permanentDeleteTemplateController = async (req, res) => {
  const tenant_id = req.user.tenant_id;
  const { template_id } = req.params;
  try {
    await permanentDeleteTemplateService(template_id, tenant_id);
    return res.status(200).json({
      success: true,
      message: "Template permanently deleted successfully from local DB and Meta",
    });
  } catch (err) {
    if (err.message?.includes("not found")) {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: err.message });
    }
    logger.error("permanentDeleteTemplateController error:", err);
    return res.status(500).json({ success: false, error_code: "INTERNAL_ERROR", message: err.message });
  }
};

export const updateWhatsappTemplateController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const updated_by =
      req.user.unique_id || req.user.tenant_user_id || req.user.id || null;
    const { template_id } = req.params;
    const {
      template_name,
      category,
      template_type,
      language,
      components,
      variables,
    } = req.body;

    if (!tenant_id) {
      return res.status(400).json({ message: "Invalid tenant context" });
    }

    const result = await updateWhatsappTemplateService(
      template_id,
      tenant_id,
      template_name,
      category,
      template_type,
      language,
      components,
      variables,
      updated_by,
    );

    return res.status(200).json({
      message: "Template updated successfully",
      data: result,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

export const resubmitWhatsappTemplateController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { template_id } = req.params;

    if (!tenant_id) {
      return res.status(400).json({ message: "Invalid tenant context" });
    }

    // WhatsApp account
    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      return res.status(400).json({
        message: "WhatsApp account not active",
      });
    }

    // Get template
    const [[template]] = await db.sequelize.query(
      `
      SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE}
      WHERE template_id = ? AND tenant_id = ? AND is_deleted = false
      `,
      { replacements: [template_id, tenant_id] },
    );

    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    // Only allow resubmit for draft, rejected, paused, approved
    if (
      !["draft", "rejected", "paused", "approved"].includes(template.status)
    ) {
      return res.status(400).json({
        message: `Cannot resubmit template with status: ${template.status}. Only draft, rejected, paused, or approved templates can be resubmitted.`,
      });
    }

    // Get components and variables
    const [components] = await db.sequelize.query(
      `
      SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS}
      WHERE template_id = ?
      `,
      { replacements: [template_id] },
    );

    const [variables] = await db.sequelize.query(
      `
      SELECT * FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES}
      WHERE template_id = ?
      ORDER BY variable_key ASC
      `,
      { replacements: [template_id] },
    );

    const result = await submitWhatsappTemplateService({
      template,
      components,
      variables,
      whatsappAccount,
    });

    return res.status(200).json({
      message: "Template resubmitted successfully",
      data: result,
    });
  } catch (err) {
    // Handle Meta "Template being deleted" error specifically
    if (
      err.metaError &&
      err.metaError.code === 100 &&
      err.metaError.error_subcode === 2388023
    ) {
      return res.status(409).json({
        message:
          "This template name was recently deleted on Meta. Please wait approx. 1 minute before resubmitting, or use a different name.",
        error_code: "META_TEMPLATE_DELETION_PENDING",
        meta_error: err.metaError,
      });
    }

    return res.status(500).json({
      message: err.message,
    });
  }
};

export const generateAiTemplateController = async (req, res) => {
  try {
    const tenant_id = req.user.tenant_id;
    const { getTenantSettingsService } =
      await import("../TenantModel/tenant.service.js");
    const tenantSettings = await getTenantSettingsService(tenant_id);

    if (tenantSettings?.ai_settings?.content_generation === false) {
      return res.status(403).json({
        message:
          "AI Template Generation is disabled for your organization. Please enable it in Settings.",
      });
    }

    const {
      prompt,
      focus,
      style,
      optimization,
      language,
      previous_content,
      rejection_reason,
    } = req.body;

    const requiredFields = {
      prompt,
      focus,
      style,
      optimization,
    };

    const missingFields = await missingFieldsChecker(requiredFields);
    if (missingFields.length > 0) {
      return res.status(400).send({
        message: `Missing required field(s): ${missingFields.join(", ")}`,
      });
    }

    const aiContent = await generateTemplateContentService({
      tenant_id,
      prompt,
      focus,
      style,
      optimization,
      language: language || 'English',
      previous_content,
      rejection_reason,
    });

    return res.status(200).json({
      message: "AI template content generated successfully",
      data: {
        content: aiContent,
      },
    });
  } catch (err) {
    console.error("AI Generation error:", err);
    return res.status(500).json({
      message: err.message,
    });
  }
};

export const uploadTemplateMediaController = async (req, res) => {
  try {
    const tenant_id = req.user?.tenant_id;
    const userId = req.user?.unique_id || req.user?.tenant_user_id || req.user?.id;

    if (!tenant_id) {
      return res.status(400).json({ message: "Invalid tenant context" });
    }
    if (!req.files || !req.files.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      return res.status(400).json({ message: "WhatsApp account not active" });
    }

    const media = await uploadMediaService(
      req.files.file,
      tenant_id,
      userId,
      whatsappAccount.access_token,
      whatsappAccount.app_id || process.env.META_APP_ID,
      { folder: "template-header", tags: ["template"] },
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
