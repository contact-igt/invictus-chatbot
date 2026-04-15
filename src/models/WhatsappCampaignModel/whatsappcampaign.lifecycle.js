/**
 * whatsappcampaign.lifecycle.js
 *
 * CASCADE:
 *   whatsapp_campaigns
 *     └─ campaign_events                 hard-delete cascade
 *     └─ whatsapp_campaign_recipients    hard-delete cascade
 */

import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  annotateDeletedRows,
  isRestoreEligible,
  RestoreExpiredError,
  NotFoundError,
  lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchCampaign = async (campaignId, tenant_id, transaction = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, campaign_id, campaign_name, status, is_deleted, deleted_at
     FROM ${tableNames.WHATSAPP_CAMPAIGN}
     WHERE campaign_id = ? AND tenant_id = ?
     LIMIT 1 FOR UPDATE`,
    { replacements: [campaignId, tenant_id], transaction },
  );
  return rows[0] || null;
};

export const softDeleteCampaign = async (campaignId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchCampaign(campaignId, tenant_id, t);
    if (!row) throw new NotFoundError("Campaign not found");
    if (row.is_deleted) throw new Error("Campaign is already deleted");

    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_CAMPAIGN}
       SET is_deleted = true, deleted_at = NOW(), status = 'deleted', updated_at = NOW()
       WHERE campaign_id = ? AND tenant_id = ?`,
      { replacements: [campaignId, tenant_id], transaction: t },
    );
  });
};

export const restoreCampaign = async (campaignId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchCampaign(campaignId, tenant_id, t);
    if (!row) throw new NotFoundError("Campaign not found");
    if (!row.is_deleted) throw new Error("Campaign is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();

    await db.sequelize.query(
      `UPDATE ${tableNames.WHATSAPP_CAMPAIGN}
       SET is_deleted = false, deleted_at = NULL, status = 'completed', updated_at = NOW()
       WHERE campaign_id = ? AND tenant_id = ?`,
      { replacements: [campaignId, tenant_id], transaction: t },
    );

    return row;
  });
};

export const hardDeleteCampaign = async (campaignId, tenant_id) => {
  return db.sequelize.transaction(async (t) => {
    const row = await fetchCampaign(campaignId, tenant_id, t);
    if (!row) throw new NotFoundError("Campaign not found");

    // 1. Delete events (leaf node)
    await db.sequelize.query(
      `DELETE ce FROM ${tableNames.CAMPAIGN_EVENTS} ce
       JOIN ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r ON r.id = ce.recipient_id
       WHERE r.campaign_id = ?`,
      { replacements: [campaignId], transaction: t },
    );

    // 2. Delete recipients
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT}
       WHERE campaign_id = ?`,
      { replacements: [campaignId], transaction: t },
    );

    // 3. Delete parent
    await db.sequelize.query(
      `DELETE FROM ${tableNames.WHATSAPP_CAMPAIGN}
       WHERE campaign_id = ? AND tenant_id = ?`,
      { replacements: [campaignId, tenant_id], transaction: t },
    );
  });
};

export const getDeletedCampaigns = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;

  const [rows] = await db.sequelize.query(
    `SELECT campaign_id, campaign_name, campaign_type, total_audience,
            delivered_count, read_count, scheduled_at, deleted_at, created_at
     FROM ${tableNames.WHATSAPP_CAMPAIGN}
     WHERE tenant_id = ? AND is_deleted = true
     ORDER BY deleted_at DESC
     LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );

  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.WHATSAPP_CAMPAIGN}
     WHERE tenant_id = ? AND is_deleted = true`,
    { replacements: [tenant_id] },
  );

  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

// Controllers
export const softDeleteCampaignController = lifecycleHandler(async (req, res) => {
  await softDeleteCampaign(req.params.campaign_id, req.user.tenant_id);
  return res.status(200).json({ message: "Campaign moved to trash" });
});

export const restoreCampaignController = lifecycleHandler(async (req, res) => {
  const data = await restoreCampaign(req.params.campaign_id, req.user.tenant_id);
  return res.status(200).json({ message: "Campaign restored", data });
});

export const hardDeleteCampaignController = lifecycleHandler(async (req, res) => {
  await hardDeleteCampaign(req.params.campaign_id, req.user.tenant_id);
  return res.status(200).json({ message: "Campaign and all delivery records permanently deleted" });
});

export const getDeletedCampaignsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedCampaigns(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
