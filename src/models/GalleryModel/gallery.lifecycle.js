/**
 * gallery.lifecycle.js
 *
 * Completes the media_assets lifecycle with:
 *  - 30-day expiry check on restore
 *  - Hard-delete (with R2 file purge)
 *  - getDeletedItems with days_remaining annotation
 *
 * The existing gallery.service.js handles soft-delete and basic restore.
 * This file adds the missing pieces and re-exports a unified surface.
 *
 * CASCADE on hard-delete:
 *   media_assets
 *     └─ R2 preview file        → DeleteObjectCommand
 *     └─ whatsapp_templates     → SET media_asset_id = NULL
 *     └─ whatsapp_campaigns     → SET media_asset_id = NULL
 */

import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { deletePreviewFromStorage } from "../../services/storageService.js";
import {
  annotateDeletedRows,
  isRestoreEligible,
  RestoreExpiredError,
  NotFoundError,
  lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

// ── Internal helpers ──────────────────────────────────────────────────────────

const fetchAsset = async (assetId, tenant_id, transaction = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, media_asset_id, file_name, file_type, preview_url,
            is_deleted, deleted_at
     FROM ${tableNames.MEDIA_ASSETS}
     WHERE media_asset_id = ? AND tenant_id = ?
     LIMIT 1 FOR UPDATE`,
    { replacements: [assetId, tenant_id], transaction },
  );
  return rows[0] || null;
};

// ── Service: restoreMediaAssetWithCheck ──────────────────────────────────────
// Re-implements restore with the 30-day window check that the existing
// restoreMediaAssetService does not enforce.
export const restoreMediaAssetWithCheck = async (assetId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchAsset(assetId, tenant_id, t);
    if (!row) throw new NotFoundError("Media asset not found");
    if (!row.is_deleted) throw new Error("Media asset is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();

    await db.sequelize.query(
      `UPDATE ${tableNames.MEDIA_ASSETS}
       SET is_deleted = false, deleted_at = NULL, updated_at = NOW()
       WHERE media_asset_id = ? AND tenant_id = ?`,
      { replacements: [assetId, tenant_id], transaction: t },
    );

    return row;
  });
};

// ── Service: hardDeleteMediaAsset ────────────────────────────────────────────
export const hardDeleteMediaAsset = async (assetId, tenant_id) => {
  let previewUrl = null;

  await db.sequelize.transaction(async (t) => {
    const row = await fetchAsset(assetId, tenant_id, t);
    if (!row) throw new NotFoundError("Media asset not found");

    previewUrl = row.preview_url;

    // 1. Nullify FK references in templates
    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_TEMPLATE}
       SET media_asset_id = NULL, updated_at = NOW()
       WHERE tenant_id = ? AND media_asset_id = ?`,
      { replacements: [tenant_id, assetId], transaction: t },
    );

    // 2. Nullify FK references in campaigns
    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_CAMPAIGN}
       SET media_asset_id = NULL, updated_at = NOW()
       WHERE tenant_id = ? AND media_asset_id = ?`,
      { replacements: [tenant_id, assetId], transaction: t },
    );

    // 3. Delete the DB row
    await db.sequelize.query(
      `DELETE FROM ${tableNames.MEDIA_ASSETS}
       WHERE media_asset_id = ? AND tenant_id = ?`,
      { replacements: [assetId, tenant_id], transaction: t },
    );
  });

  // Phase 2: delete R2 file outside transaction (non-blocking on error)
  if (previewUrl) {
    await deletePreviewFromStorage(previewUrl);
  }
};

// ── Service: getDeletedMediaAssets ───────────────────────────────────────────
export const getDeletedMediaAssets = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;

  const [rows] = await db.sequelize.query(
    `SELECT media_asset_id, file_name, file_type, mime_type,
            file_size, preview_url, is_approved, deleted_at, created_at
     FROM ${tableNames.MEDIA_ASSETS}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC
     LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );

  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.MEDIA_ASSETS}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );

  return {
    items: annotateDeletedRows(rows),
    total: Number(total),
    page,
    limit,
  };
};

// ── Controllers ───────────────────────────────────────────────────────────────

export const restoreMediaAssetController = lifecycleHandler(async (req, res) => {
  const { asset_id } = req.params;
  const { tenant_id } = req.user;
  const data = await restoreMediaAssetWithCheck(asset_id, tenant_id);
  return res.status(200).json({ message: "Media asset restored", data });
});

export const hardDeleteMediaAssetController = lifecycleHandler(async (req, res) => {
  const { asset_id } = req.params;
  const { tenant_id } = req.user;
  await hardDeleteMediaAsset(asset_id, tenant_id);
  return res.status(200).json({ message: "Media asset permanently deleted and file purged from storage" });
});

export const getDeletedMediaAssetsController = lifecycleHandler(async (req, res) => {
  const { tenant_id } = req.user;
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedMediaAssets(tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
