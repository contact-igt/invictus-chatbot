/**
 * Gallery Service
 * Business logic for media asset management
 */

import db from "../../database/index.js";
import { Op } from "sequelize";
import { uploadMediaToMeta } from "../../services/mediaUploadService.js";
import { validateMediaFile, getFileTypeFromMimeType } from "../../utils/mediaValidation.js";

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

    // Upload to Meta Resumable Upload API
    const mediaHandle = await uploadMediaToMeta(
      file.data,
      file.mimetype,
      accessToken,
      appId,
    );

    // Create MediaAsset record
    const mediaAsset = await db.MediaAsset.create({
      media_asset_id: `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      tenant_id: tenantId,
      file_name: file.name,
      file_type: fileType,
      mime_type: file.mimetype,
      file_size: file.size,
      media_handle: mediaHandle,
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
    console.error("Error in uploadMediaService:", error);
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
    console.error("Error in listMediaAssetsService:", error);
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
      where: {
        media_asset_id: assetId,
        tenant_id: tenantId,
        is_deleted: false,
      },
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    return mediaAsset;
  } catch (error) {
    console.error("Error in getMediaAssetService:", error);
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
      where: {
        media_asset_id: assetId,
        tenant_id: tenantId,
        is_deleted: false,
      },
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    // Check if media is approved (used in approved templates)
    if (mediaAsset.is_approved) {
      throw new Error(
        "Cannot delete media used in approved templates. Please delete or update the templates first.",
      );
    }

    // Soft delete the record
    mediaAsset.is_deleted = true;
    mediaAsset.deleted_at = new Date();
    await mediaAsset.save();

    return {
      success: true,
      message: "Media asset deleted successfully",
    };
  } catch (error) {
    console.error("Error in deleteMediaAssetService:", error);
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
      where: {
        media_asset_id: assetId,
        tenant_id: tenantId,
        is_deleted: false,
      },
    });

    if (!mediaAsset) {
      throw new Error("Media asset not found");
    }

    // Update tags
    mediaAsset.tags = tags;
    await mediaAsset.save();

    return mediaAsset;
  } catch (error) {
    console.error("Error in updateMediaTagsService:", error);
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
    console.error("Error in markMediaAsApprovedService:", error);
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
    if (!mediaAsset.templates_used.includes(templateId)) {
      mediaAsset.templates_used = [...mediaAsset.templates_used, templateId];
      await mediaAsset.save();
    }

    return mediaAsset;
  } catch (error) {
    console.error("Error in addTemplateUsageService:", error);
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
    if (!mediaAsset.campaigns_used.includes(campaignId)) {
      mediaAsset.campaigns_used = [...mediaAsset.campaigns_used, campaignId];
      await mediaAsset.save();
    }

    return mediaAsset;
  } catch (error) {
    console.error("Error in addCampaignUsageService:", error);
    throw error;
  }
};
