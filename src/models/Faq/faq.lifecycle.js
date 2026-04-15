/**
 * faq.lifecycle.js
 *
 * Extends the existing faq.service.js softDeleteFaqService with:
 *  - 30-day restore-window check
 *  - Hard-delete (removes faq_knowledge_source + triggers chunk rebuild)
 *  - getDeletedFaqs with days_remaining annotation
 *
 * faq_reviews uses status='deleted' as its soft-delete signal.
 * We also write is_deleted=true here for consistency with the master cron.
 *
 * CASCADE:
 *   faq_reviews
 *     └─ faq_knowledge_source    set is_active=false on soft-delete
 *                                hard-delete on hard-delete
 *     └─ knowledge_chunks        rebuild after restore (two-phase: outside transaction)
 */

import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { syncFaqKnowledgeChunks } from "../../utils/ai/faqKnowledgeChunkSync.js";
import { ensureFaqMasterSource } from "../../utils/ai/faqSourceHelper.js";
import {
  annotateDeletedRows,
  isRestoreEligible,
  RestoreExpiredError,
  NotFoundError,
  lifecycleHandler,
} from "../../utils/lifecycle/deleteUtils.js";

const fetchFaq = async (id, tenant_id, transaction = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT fr.id, fr.question, fr.status, fr.deleted_at,
            fk.source_id, fk.id AS knowledge_entry_id
     FROM ${tableNames.FAQ_REVIEWS} fr
     LEFT JOIN ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
       ON fk.faq_review_id = fr.id AND fk.tenant_id = fr.tenant_id
     WHERE fr.id = ? AND fr.tenant_id = ?
     LIMIT 1 FOR UPDATE`,
    { replacements: [id, tenant_id], transaction },
  );
  return rows[0] || null;
};

// ── Service: restoreFaqReview ─────────────────────────────────────────────────
// The soft-delete is already handled by faq.service.js softDeleteFaqService.
// This function handles the RESTORE path with the 30-day expiry check.
export const restoreFaqReview = async (id, tenant_id) => {
  let sourceId = null;

  await db.sequelize.transaction(async (t) => {
    const row = await fetchFaq(id, tenant_id, t);
    if (!row) throw new NotFoundError("FAQ review not found");
    if (row.status !== "deleted") throw new Error("FAQ review is not deleted");
    if (!isRestoreEligible(row.deleted_at)) throw new RestoreExpiredError();

    // Restore the FAQ review
    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_REVIEWS}
       SET status = 'published', is_active = true, deleted_at = NULL, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );

    // Re-activate the knowledge source entry
    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       SET is_active = true, updated_at = NOW()
       WHERE faq_review_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );

    sourceId = row.source_id || null;
  });

  // Phase 2: rebuild embeddings outside transaction
  if (!sourceId) {
    const master = await ensureFaqMasterSource(tenant_id);
    sourceId = master?.id;
  }
  if (sourceId) {
    await syncFaqKnowledgeChunks(tenant_id, sourceId);
  }
};

// ── Service: hardDeleteFaqReview ──────────────────────────────────────────────
export const hardDeleteFaqReview = async (id, tenant_id) => {
  let sourceId = null;

  await db.sequelize.transaction(async (t) => {
    const row = await fetchFaq(id, tenant_id, t);
    if (!row) throw new NotFoundError("FAQ review not found");

    sourceId = row.source_id || null;

    // 1. Delete the knowledge source entry
    await db.sequelize.query(
      `DELETE FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       WHERE faq_review_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );

    // 2. Delete the FAQ review
    await db.sequelize.query(
      `DELETE FROM ${tableNames.FAQ_REVIEWS}
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction: t },
    );
  });

  // Phase 2: rebuild remaining active chunks outside transaction
  if (!sourceId) {
    const master = await ensureFaqMasterSource(tenant_id);
    sourceId = master?.id;
  }
  if (sourceId) {
    await syncFaqKnowledgeChunks(tenant_id, sourceId);
  }
};

// ── Service: getDeletedFaqReviews ─────────────────────────────────────────────
export const getDeletedFaqReviews = async (tenant_id, page = 1, limit = 20) => {
  const offset = (page - 1) * limit;

  const [rows] = await db.sequelize.query(
    `SELECT id, question, normalized_question, doctor_answer, agent_category,
            whatsapp_number, deleted_at, created_at
     FROM ${tableNames.FAQ_REVIEWS}
     WHERE tenant_id = ? AND status = 'deleted'
     ORDER BY deleted_at DESC
     LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );

  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.FAQ_REVIEWS}
     WHERE tenant_id = ? AND status = 'deleted'`,
    { replacements: [tenant_id] },
  );

  return { items: annotateDeletedRows(rows), total: Number(total), page, limit };
};

// ── Controllers ───────────────────────────────────────────────────────────────

export const restoreFaqReviewController = lifecycleHandler(async (req, res) => {
  await restoreFaqReview(req.params.id, req.user.tenant_id);
  return res.status(200).json({ message: "FAQ review restored and embeddings rebuilt" });
});

export const hardDeleteFaqReviewController = lifecycleHandler(async (req, res) => {
  await hardDeleteFaqReview(req.params.id, req.user.tenant_id);
  return res.status(200).json({ message: "FAQ review permanently deleted" });
});

export const getDeletedFaqReviewsController = lifecycleHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const data = await getDeletedFaqReviews(req.user.tenant_id, parseInt(page), Math.min(parseInt(limit), 100));
  return res.status(200).json({ message: "success", data });
});
