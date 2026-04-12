/**
 * Gallery Controller
 * Handles HTTP requests for media gallery operations
 */

import {
  uploadMediaService,
  listMediaAssetsService,
  getMediaAssetService,
  deleteMediaAssetService,
  updateMediaTagsService,
  restoreMediaAssetService,
} from "./gallery.service.js";
import { getWhatsappAccountByTenantService } from "../WhatsappAccountModel/whatsappAccount.service.js";
import { logger } from "../../utils/logger.js";

/**
 * Upload media file
 * POST /api/whatsapp/gallery/upload
 */
export const uploadMediaController = async (req, res) => {
  try {
    const { tags, folder } = req.body;
    const tenant_id = req.user?.tenant_id;
    const userId = req.user?.unique_id || req.user?.tenant_user_id || req.user?.id;

    // Validate required fields
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required",
      });
    }

    // Check if file is uploaded
    if (!req.files || !req.files.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const file = req.files.file;

    // Get WhatsApp account for access token and app ID
    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "No active WhatsApp account found for this tenant",
      });
    }

    const accessToken = whatsappAccount.access_token;
    // Use app_id from account if available, otherwise fallback to env
    const appId = whatsappAccount.app_id || process.env.META_APP_ID;

    if (!appId) {
      return res.status(500).json({
        success: false,
        message: "META_APP_ID not configured. Please provide it in WhatsApp settings.",
      });
    }

    // Parse tags if provided as string
    let parsedTags = [];
    if (tags) {
      parsedTags = typeof tags === "string" ? JSON.parse(tags) : tags;
    }

    // Upload media
    const mediaAsset = await uploadMediaService(
      file,
      tenant_id,
      userId,
      accessToken,
      appId,
      {
        tags: parsedTags,
        folder: folder || "root",
      },
    );

    return res.status(201).json({
      success: true,
      message: "Media uploaded successfully",
      data: {
        asset_id: mediaAsset.media_asset_id,
        media_handle: mediaAsset.media_handle,
        preview_url: mediaAsset.preview_url,
        file_name: mediaAsset.file_name,
        file_type: mediaAsset.file_type,
        file_size: mediaAsset.file_size,
        mime_type: mediaAsset.mime_type,
        tags: mediaAsset.tags,
        folder: mediaAsset.folder,
        is_approved: mediaAsset.is_approved,
        created_at: mediaAsset.createdAt,
      },
    });
  } catch (error) {
    logger.error("Error in uploadMediaController:", error);
    return res.status(500).json({
      success: false,
      error_code: "UPLOAD_FAILED",
      message: error.message || "Failed to upload media",
    });
  }
};

/**
 * List media assets
 * GET /api/whatsapp/gallery
 */
export const listMediaAssetsController = async (req, res) => {
  try {
    const { type, search, tags, folder, approved_only, pending_only, page, limit } = req.query;
    const tenant_id = req.user?.tenant_id;

    // Validate required fields
    if (!tenant_id) {
      return res.status(401).json({
        success: false,
        error_code: "UNAUTHORIZED",
        message: "Authentication required",
      });
    }

    // Parse tags if provided
    let parsedTags = null;
    if (tags) {
      parsedTags = typeof tags === "string" ? tags.split(",") : tags;
    }

    const filters = {
      type,
      search,
      tags: parsedTags,
      folder,
      approved_only,
      pending_only,
    };

    const pagination = {
      page: page || 1,
      limit: limit || 20,
    };

    const result = await listMediaAssetsService(tenant_id, filters, pagination);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Error in listMediaAssetsController:", error);
    return res.status(500).json({
      success: false,
      error_code: "INTERNAL_ERROR",
      message: error.message || "Failed to list media assets",
    });
  }
};

/**
 * Get single media asset
 * GET /api/whatsapp/gallery/:asset_id
 */
export const getMediaAssetController = async (req, res) => {
  try {
    const { asset_id } = req.params;
    const tenant_id = req.user?.tenant_id;

    // Validate required fields
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required",
      });
    }

    const mediaAsset = await getMediaAssetService(asset_id, tenant_id);

    return res.status(200).json({
      success: true,
      data: mediaAsset,
    });
  } catch (error) {
    logger.error("Error in getMediaAssetController:", error);
    if (error.message === "Media asset not found") {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: error.message });
    }
    return res.status(500).json({ success: false, error_code: "INTERNAL_ERROR", message: error.message || "Failed to get media asset" });
  }
};

/**
 * Delete media asset
 * DELETE /api/whatsapp/gallery/:asset_id
 */
export const deleteMediaAssetController = async (req, res) => {
  try {
    const { asset_id } = req.params;
    const tenant_id = req.user?.tenant_id;

    // Validate required fields
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required",
      });
    }

    const result = await deleteMediaAssetService(asset_id, tenant_id);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error("Error in deleteMediaAssetController:", error);
    if (error.message === "Media asset not found") {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: error.message });
    }
    if (error.message.includes("linked") || error.message.includes("used in")) {
      return res.status(409).json({ success: false, error_code: "ASSET_IN_USE", message: error.message });
    }
    return res.status(400).json({ success: false, error_code: "DELETE_FAILED", message: error.message || "Failed to delete media asset" });
  }
};

/**
 * Restore soft-deleted media asset
 * POST /api/whatsapp/gallery/:asset_id/restore
 */
export const restoreMediaAssetController = async (req, res) => {
  try {
    const { asset_id } = req.params;
    const tenant_id = req.user?.tenant_id;

    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required",
      });
    }

    const result = await restoreMediaAssetService(asset_id, tenant_id);
    return res.status(200).json(result);
  } catch (error) {
    logger.error("Error in restoreMediaAssetController:", error);
    if (error.message === "Asset not found or not deleted") {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: error.message });
    }
    return res.status(400).json({ success: false, error_code: "RESTORE_FAILED", message: error.message || "Failed to restore media asset" });
  }
};

/**
 * Update media asset tags
 * PATCH /api/whatsapp/gallery/:asset_id/tags
 */
export const updateMediaTagsController = async (req, res) => {
  try {
    const { asset_id } = req.params;
    const { tags } = req.body;
    const tenant_id = req.user?.tenant_id;

    // Validate required fields
    if (!tenant_id) {
      return res.status(400).json({
        success: false,
        message: "tenant_id is required",
      });
    }

    if (!tags || !Array.isArray(tags)) {
      return res.status(400).json({
        success: false,
        error_code: "MISSING_FIELD",
        message: "tags must be a non-empty array",
      });
    }

    const mediaAsset = await updateMediaTagsService(asset_id, tenant_id, tags);

    return res.status(200).json({
      success: true,
      message: "Tags updated successfully",
      data: mediaAsset,
    });
  } catch (error) {
    logger.error("Error in updateMediaTagsController:", error);
    if (error.message === "Media asset not found") {
      return res.status(404).json({ success: false, error_code: "NOT_FOUND", message: error.message });
    }
    return res.status(500).json({ success: false, error_code: "INTERNAL_ERROR", message: error.message || "Failed to update tags" });
  }
};
