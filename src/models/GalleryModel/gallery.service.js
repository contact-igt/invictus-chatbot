/**
 * Gallery Service
 * Business logic for media asset management
 */

import db from "../../database/index.js";
import { Op } from "sequelize";
import { tableNames } from "../../database/tableName.js";
import { uploadMediaToMeta } from "../../services/mediaUploadService.js";
import { validateMediaFile, getFileTypeFromMimeType } from "../../utils/mediaValidation.js";
import {
  uploadPreviewToStorage,
  deletePreviewFromStorage,
} from "../../services/storageService.js";
import { logger } from "../../utils/logger.js";

const normalizeUsageArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const buildAssetLookupWhere = (assetId, tenantId, includeDeleted = false) => {
  const where = {
    tenant_id: tenantId,
    ...(includeDeleted ? {} : { is_deleted: false }),
  };

  const numericId = Number(assetId);
  if (!Number.isNaN(numericId) && String(numericId) === String(assetId)) {
    where[Op.or] = [{ media_asset_id: assetId }, { id: numericId }];
  } else {
    where.media_asset_id = assetId;
  }

  return where;
};

const getActiveUsageIds = async (tenantId, templateIds = [], campaignIds = []) => {
  const activeTemplateIds = [];
  const activeCampaignIds = [];

  if (templateIds.length > 0) {
    const [rows] = await db.sequelize.query(
      `
      SELECT template_id
      FROM ${tableNames.WHATSAPP_TEMPLATE}
      WHERE tenant_id = ?
        AND is_deleted = false
        AND template_id IN (?)
      `,
      { replacements: [tenantId, templateIds] },
    );
    for (const row of rows) activeTemplateIds.push(row.template_id);
  }

  if (campaignIds.length > 0) {
    const [rows] = await db.sequelize.query(
      `
      SELECT campaign_id
      FROM ${tableNames.WHATSAPP_CAMPAIGN}
      WHERE tenant_id = ?
        AND is_deleted = false
        AND campaign_id IN (?)
      `,
      { replacements: [tenantId, campaignIds] },
    );
    for (const row of rows) activeCampaignIds.push(row.campaign_id);
  }

  return { activeTemplateIds, activeCampaignIds };
};

/**
 * Upload media file to Meta and create MediaAsset record
 * @param {Object} file - File object from express-fileupload
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID who uploaded the file
 * @param {string} accessToken - WhatsApp access token
 * @param {string} appId - Meta App ID
 * @param {Object} metadata - Additional metadata (tags, folder)
 * @returns {Promise<Object>} Created MediaAsset record
 */
export const uploadMediaService = async (
  file,
  tenantId,
  userId,
  accessToken,
  appId,
  metadata = {},
) => {
  try {
    // Determine file type from MIME type
    const fileType = getFileTypeFromMimeType(file.mimetype);
    if (!fileType) {
      throw new Error(`Unsupported file type: ${file.mimetype}`);
    }

    // Validate file
    const validation = validateMediaFile(
      {
        name: file.name,
        size: file.size,
        mimetype: file.mimetype,
        buffer: file.data,
      },
      fileType,
    );

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Generate asset ID before uploads (needed for R2 file key)
    const assetId = `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Upload to Meta Resumable Upload API
    const mediaHandle = await uploadMediaToMeta(
      file.data,
      file.mimetype,
      accessToken,
      appId,
    );

    // Upload thumbnail preview to R2 for Gallery UI display
    // Non-blocking — previewUrl is null if upload fails or file is video
    // This does NOT affect media_handle or Meta upload in any way
    const previewUrl = await uploadPreviewToStorage(
      file.data,
      file.mimetype,
      fileType,
      file.name,
      tenantId,
      assetId,
    );

    // Create MediaAsset record
    const mediaAsset = await db.MediaAsset.create({
      media_asset_id: assetId,
      tenant_id: tenantId,
      file_name: file.name,
      file_type: fileType,
      mime_type: file.mimetype,
      file_size: file.size,
      media_handle: mediaHandle,
      preview_url: previewUrl,
      tags: metadata.tags || [],
      folder: metadata.folder || "root",
      is_approved: false,
      templates_used: [],
      campaigns_used: [],
      uploaded_by: userId,
      is_deleted: false,
    });

    return mediaAsset;
  } catch (error) {
    logger.error("Error in uploadMediaService:", error);
    throw error;
  }
};

/**
 * List media assets with filtering and pagination
 * @param {string} tenantId - Tenant ID
 * @param {Object} filters - Filter options
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} Paginated media assets
 */
export const listMediaAssetsService = async (tenantId, filters = {}, pagination = {}) => {
  try {
    const {
      type,
      search,
      tags,
      folder,
      approved_only,
      pending_only,
    } = filters;

    const {
      page = 1,
      limit = 20,
    } = pagination;
    

    const offset = (page - 1) * limit;

    // Build where clause
    const whereClause = {
      tenant_id: tenantId,
      is_deleted: false,
    };

    // Filter by file type
    if (type && type !== "all") {
      whereClause.file_type = type;
    }

    // Filter by approval status
    if (approved_only === "true" || approved_only === true) {
      whereClause.is_approved = true;
    }

    // Filter by pending status (not approved)
    if (pending_only === "true" || pending_only === true) {
      whereClause.is_approved = false;
    }

    // Filter by folder
    if (folder) {
      whereClause.folder = folder;
    }

    // Search by file name (Op.like is MySQL-compatible; Op.iLike is PostgreSQL-only)
    if (search) {
      whereClause.file_name = {
        [Op.like]: `%${search}%`,
      };
    }

    // Query database
    const { count, rows } = await db.MediaAsset.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    return {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit),
      data: rows,
    };
  } catch (error) {
    logger.error("Error in listMediaAssetsService:", error);
    throw error;
  }
};

/**
 * Get single media asset by ID
 * @param {string} assetId - Media asset ID
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Media asset record
 */
export const getMediaAssetService = async (assetId, tenantId) => {
  try {
    const mediaAsset = await db.MediaAsset.findOne({
      where: buildAssetLookupWhere(assetId, tenantId),
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    return mediaAsset;
  } catch (error) {
    logger.error("Error in getMediaAssetService:", error);
    throw error;
  }
};

/**
 * Delete media asset
 * @param {string} assetId - Media asset ID
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Deletion result
 */
export const deleteMediaAssetService = async (assetId, tenantId) => {
  try {
    const mediaAsset = await db.MediaAsset.findOne({
      where: buildAssetLookupWhere(assetId, tenantId),
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    if (mediaAsset.is_approved) {
      throw new Error("Cannot delete approved media asset");
    }
    const templateUsage = normalizeUsageArray(mediaAsset.templates_used).filter(Boolean);
    const campaignUsage = normalizeUsageArray(mediaAsset.campaigns_used).filter(Boolean);

    const { activeTemplateIds, activeCampaignIds } = await getActiveUsageIds(
      tenantId,
      templateUsage,
      campaignUsage,
    );

    if (
      activeTemplateIds.length !== templateUsage.length ||
      activeCampaignIds.length !== campaignUsage.length
    ) {
      mediaAsset.templates_used = activeTemplateIds;
      mediaAsset.campaigns_used = activeCampaignIds;
      await mediaAsset.save();
    }

    if (activeTemplateIds.length > 0) {
      throw new Error("Cannot delete - media is linked to an active template");
    }

    if (activeCampaignIds.length > 0) {
      throw new Error("Cannot delete - media is used in an active campaign");
    }

    // Soft delete only — do NOT delete from R2 by default
    // preview_url and media_handle are preserved for potential restore
    // Set HARD_DELETE_STORAGE=true in .env to also purge from storage
    mediaAsset.is_deleted = true;
    mediaAsset.deleted_at = new Date();
    await mediaAsset.save();

    if (String(process.env.HARD_DELETE_STORAGE).toLowerCase() === "true") {
      try {
        await deletePreviewFromStorage(mediaAsset.preview_url);
      } catch (storageErr) {
        logger.error(
          "[GALLERY-DELETE] Storage deletion failed:",
          storageErr.message,
        );
      }
    }

    return {
      success: true,
      message: "Media asset deleted successfully",
    };
  } catch (error) {
    logger.error("Error in deleteMediaAssetService:", error);
    throw error;
  }
};

/**
 * Update media asset tags
 * @param {string} assetId - Media asset ID
 * @param {string} tenantId - Tenant ID
 * @param {Array<string>} tags - New tags array
 * @returns {Promise<Object>} Updated media asset
 */
export const updateMediaTagsService = async (assetId, tenantId, tags) => {
  try {
    const mediaAsset = await db.MediaAsset.findOne({
      where: buildAssetLookupWhere(assetId, tenantId),
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    // Update tags
    mediaAsset.tags = tags;
    await mediaAsset.save();

    return mediaAsset;
  } catch (error) {
    logger.error("Error in updateMediaTagsService:", error);
    throw error;
  }
};

/**
 * Mark media as approved (called from template approval webhook)
 * @param {string} assetId - Media asset ID
 * @returns {Promise<Object>} Updated media asset
 */
export const markMediaAsApprovedService = async (assetId) => {
  try {
    const mediaAsset = await db.MediaAsset.findOne({
      where: {
        media_asset_id: assetId,
        is_deleted: false,
      },
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    mediaAsset.is_approved = true;
    await mediaAsset.save();

    return mediaAsset;
  } catch (error) {
    logger.error("Error in markMediaAsApprovedService:", error);
    throw error;
  }
};

/**
 * Add template to media asset's templates_used array
 * @param {string} assetId - Media asset ID
 * @param {string} templateId - Template ID to add
 * @returns {Promise<Object>} Updated media asset
 */
export const addTemplateUsageService = async (assetId, templateId) => {
  try {
    const mediaAsset = await db.MediaAsset.findOne({
      where: {
        media_asset_id: assetId,
        is_deleted: false,
      },
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    // Add template ID if not already present
    const existingTemplateUsage = normalizeUsageArray(mediaAsset.templates_used);
    if (!existingTemplateUsage.includes(templateId)) {
      mediaAsset.templates_used = [...existingTemplateUsage, templateId];
      await mediaAsset.save();
    }

    return mediaAsset;
  } catch (error) {
    logger.error("Error in addTemplateUsageService:", error);
    throw error;
  }
};

/**
 * Restore a soft-deleted media asset
 * @param {string} assetId - Media asset ID
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Restore result with asset details
 */
export const restoreMediaAssetService = async (assetId, tenantId) => {
  try {
    const mediaAsset = await db.MediaAsset.findOne({
      where: {
        ...buildAssetLookupWhere(assetId, tenantId, true),
        is_deleted: true,
      },
    });

    if (!mediaAsset) {
      throw new Error("Asset not found or not deleted");
    }

    mediaAsset.is_deleted = false;
    mediaAsset.deleted_at = null;
    await mediaAsset.save();

    return {
      success: true,
      asset_id: mediaAsset.media_asset_id,
      file_name: mediaAsset.file_name,
      preview_url: mediaAsset.preview_url,
      media_handle: mediaAsset.media_handle,
      message: "Media restored successfully",
    };
  } catch (error) {
    logger.error("Error in restoreMediaAssetService:", error);
    throw error;
  }
};

/**
 * Add campaign to media asset's campaigns_used array
 * @param {string} assetId - Media asset ID
 * @param {string} campaignId - Campaign ID to add
 * @returns {Promise<Object>} Updated media asset
 */
export const addCampaignUsageService = async (assetId, campaignId) => {
  try {
    const mediaAsset = await db.MediaAsset.findOne({
      where: {
        media_asset_id: assetId,
        is_deleted: false,
      },
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    // Add campaign ID if not already present
    const existingCampaignUsage = normalizeUsageArray(mediaAsset.campaigns_used);
    if (!existingCampaignUsage.includes(campaignId)) {
      mediaAsset.campaigns_used = [...existingCampaignUsage, campaignId];
      await mediaAsset.save();
    }

    return mediaAsset;
  } catch (error) {
    logger.error("Error in addCampaignUsageService:", error);
    throw error;
  }
};


