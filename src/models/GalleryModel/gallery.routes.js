/**
 * Gallery Routes
 * API routes for media gallery operations
 */

import express from "express";
import {
  uploadMediaController,
  listMediaAssetsController,
  getMediaAssetController,
  deleteMediaAssetController,
  updateMediaTagsController,
} from "./gallery.controller.js";

const router = express.Router();

// Upload media
router.post("/gallery/upload", uploadMediaController);

// List media assets
router.get("/gallery", listMediaAssetsController);

// Get single media asset
router.get("/gallery/:asset_id", getMediaAssetController);

// Delete media asset
router.delete("/gallery/:asset_id", deleteMediaAssetController);

// Update media tags
router.patch("/gallery/:asset_id/tags", updateMediaTagsController);

export default router;
