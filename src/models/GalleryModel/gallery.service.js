/**
 * Gallery Service
 * Business logic for media asset management
 */

import db from "../../database/index.js";
import { Op } from "sequelize";
import { tableNames } from "../../database/tableName.js";
import { uploadMediaToMeta } from "../../services/mediaUploadService.js";
import {
  validateMediaFile,
  getFileTypeFromMimeType,
} from "../../utils/mediaValidation.js";
import {
  uploadPreviewToStorage,
  deletePreviewFromStorage,
} from "../../services/storageService.js";
import { logger } from "../../utils/logger.js";

/**
 * Aggregate media stats for a tenant using a single SQL query.
 * Much more efficient than fetching thousands of rows to count client-side.
 * @param {string} tenantId
 * @returns {Promise<Object>} { total, images, videos, documents, approved, pending, totalSize }
 */
export const getMediaStatsService = async (tenantId) => {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT
         COUNT(*)                                                        AS total,
         SUM(CASE WHEN file_type = 'image'    THEN 1 ELSE 0 END)        AS images,
         SUM(CASE WHEN file_type = 'video'    THEN 1 ELSE 0 END)        AS videos,
         SUM(CASE WHEN file_type = 'document' THEN 1 ELSE 0 END)        AS documents,
         SUM(CASE WHEN is_approved = 1        THEN 1 ELSE 0 END)        AS approved,
         SUM(CASE WHEN is_approved = 0        THEN 1 ELSE 0 END)        AS pending,
         COALESCE(SUM(file_size), 0)                                     AS totalSize
       FROM ${tableNames.MEDIA_ASSETS}
       WHERE tenant_id = ? AND is_deleted = 0`,
      { replacements: [tenantId] },
    );
    const row = rows[0] || {};
    return {
      total: Number(row.total || 0),
      images: Number(row.images || 0),
      videos: Number(row.videos || 0),
      documents: Number(row.documents || 0),
      approved: Number(row.approved || 0),
      pending: Number(row.pending || 0),
      totalSize: Number(row.totalSize || 0),
    };
  } catch (error) {
    logger.error("Error in getMediaStatsService:", error);
    throw error;
  }
};

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

/**
 * Allowlist of permitted sort columns.
 * Keys are the values callers send; values are the actual DB column names.
 * NEVER interpolate user input directly — always resolve through this map (BUG 12).
 */
const SORT_FIELD_ALLOWLIST = {
  date: "created_at",
  name: "file_name",
  size: "file_size",
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

const getActiveUsageIds = async (
  tenantId,
  templateIds = [],
  campaignIds = [],
) => {
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
      const error = new Error(
        `Unsupported file type: ${file.mimetype}. Allowed formats: jpg, jpeg, png, mp4, pdf.`,
      );
      error.errorCode = "UNSUPPORTED_MEDIA_FORMAT";
      throw error;
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
      const error = new Error(validation.error);
      error.errorCode = "UNSUPPORTED_MEDIA_FORMAT";
      throw error;
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
      handle_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
export const listMediaAssetsService = async (
  tenantId,
  filters = {},
  pagination = {},
) => {
  try {
    const {
      type,
      search,
      tags,
      folder,
      approved_only,
      pending_only,
      show_deleted,
      sort_field,
      sort_dir,
    } = filters;

    const { page = 1, limit = 20 } = pagination;

    const offset = (page - 1) * limit;

    // Resolve safe ORDER BY values via allowlist (BUG 10 + BUG 12 — never interpolate raw user input)
    const orderColumn = SORT_FIELD_ALLOWLIST[sort_field] || "created_at";
    const orderDir = sort_dir === "asc" ? "ASC" : "DESC";

    // Build where clause
    const whereClause = {
      tenant_id: tenantId,
      is_deleted: show_deleted === "true" || show_deleted === true,
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
      order: [[orderColumn, orderDir]],
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

    const templateUsage = normalizeUsageArray(mediaAsset.templates_used).filter(
      Boolean,
    );
    const campaignUsage = normalizeUsageArray(mediaAsset.campaigns_used).filter(
      Boolean,
    );

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
    const existingTemplateUsage = normalizeUsageArray(
      mediaAsset.templates_used,
    );
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
/**
 * Sync pending media approvals on gallery refresh. Two cases:
 *   1. Media linked to an approved template → approve it (template approval path)
 *   2. Media with NO template link at all → approve it (standalone upload, nothing to wait for)
 * DB-only check — no Meta API calls.
 * @param {string} tenantId
 * @returns {Promise<number>} Count of media assets that were approved
 */
export const syncPendingMediaApprovalsService = async (tenantId) => {
  try {
    const [rows] = await db.sequelize.query(
      `SELECT ma.media_asset_id
       FROM ${tableNames.MEDIA_ASSETS} ma
       WHERE ma.tenant_id = ?
         AND ma.is_approved = false
         AND ma.is_deleted = false
         AND (
           -- Case 1: linked to an approved template
           EXISTS (
             SELECT 1 FROM ${tableNames.WHATSAPP_TEMPLATE} t
             WHERE t.tenant_id = ?
               AND t.status = 'approved'
               AND t.is_deleted = false
               AND (
                 t.media_asset_id = ma.media_asset_id
                 OR EXISTS (
                   SELECT 1 FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} c
                   WHERE c.template_id = t.template_id
                     AND c.component_type = 'header'
                     AND c.media_asset_id = ma.media_asset_id
                 )
               )
           )
           OR
           -- Case 2: not linked to any template at all (standalone upload)
           NOT EXISTS (
             SELECT 1 FROM ${tableNames.WHATSAPP_TEMPLATE} t2
             WHERE t2.tenant_id = ?
               AND t2.is_deleted = false
               AND (
                 t2.media_asset_id = ma.media_asset_id
                 OR EXISTS (
                   SELECT 1 FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} c2
                   WHERE c2.template_id = t2.template_id
                     AND c2.component_type = 'header'
                     AND c2.media_asset_id = ma.media_asset_id
                 )
               )
           )
         )`,
      { replacements: [tenantId, tenantId, tenantId] },
    );

    if (rows.length === 0) return 0;

    const assetIds = rows.map((r) => r.media_asset_id);
    await db.sequelize.query(
      `UPDATE ${tableNames.MEDIA_ASSETS}
       SET is_approved = true
       WHERE media_asset_id IN (?)
         AND tenant_id = ?`,
      { replacements: [assetIds, tenantId] },
    );

    logger.info(
      `[GALLERY-SYNC] Approved ${assetIds.length} pending media asset(s) for tenant ${tenantId}`,
    );
    return assetIds.length;
  } catch (error) {
    logger.error("Error in syncPendingMediaApprovalsService:", error);
    // Non-fatal — caller should fire-and-forget
    return 0;
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
    const existingCampaignUsage = normalizeUsageArray(
      mediaAsset.campaigns_used,
    );
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
