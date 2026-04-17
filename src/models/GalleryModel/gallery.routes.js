/**
 * Gallery Routes
 * API routes for media gallery operations
 */

import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  uploadMediaController,
  listMediaAssetsController,
  getMediaAssetController,
  deleteMediaAssetController,
  updateMediaTagsController,
  getMediaStatsController,
} from "./gallery.controller.js";
import {
  restoreMediaAssetController,
  hardDeleteMediaAssetController,
  getDeletedMediaAssetsController,
} from "./gallery.lifecycle.js";

const router = express.Router();
const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

// Upload media
router.post(
  "/gallery/upload",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  uploadMediaController,
);

// List media assets
router.get(
  "/gallery",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  listMediaAssetsController,
);

// Media stats — must be before /gallery/:asset_id so "stats" is not treated as an asset_id
router.get(
  "/gallery/stats",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getMediaStatsController,
);

// Deleted media assets (trash list)
router.get(
  "/gallery/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getDeletedMediaAssetsController,
);

// Get single media asset
router.get(
  "/gallery/:asset_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getMediaAssetController,
);

// Delete media asset (soft delete)
router.delete(
  "/gallery/:asset_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  deleteMediaAssetController,
);

// Update media tags
router.patch(
  "/gallery/:asset_id/tags",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateMediaTagsController,
);

// Restore soft-deleted media asset (30-day window enforced)
router.post(
  "/gallery/:asset_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  restoreMediaAssetController,
);

// Permanently delete media asset + purge R2 file (admin only)
router.delete(
  "/gallery/:asset_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  hardDeleteMediaAssetController,
);

// REST aliases (v1 contract friendly)
router.post(
  "/media/upload",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  uploadMediaController,
);
router.get(
  "/media",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  listMediaAssetsController,
);
router.get(
  "/media/:asset_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getMediaAssetController,
);
router.delete(
  "/media/:asset_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  deleteMediaAssetController,
);

export default router;
