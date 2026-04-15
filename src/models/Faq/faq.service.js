import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  ensureFaqMasterSource,
  ensureFaqMasterSourceInTransaction,
} from "../../utils/ai/faqSourceHelper.js";
import {
  syncFaqKnowledgeChunks,
  syncFaqKnowledgeChunksIfStale,
} from "../../utils/ai/faqKnowledgeChunkSync.js";

const buildFaqPayload = ({
  question,
  answer,
  updatedBy = null,
  publishedStatus = "published",
  source = "doctor_faq",
}) => ({
  question,
  answer,
  published_status: publishedStatus,
  source,
  updated_at: new Date().toISOString(),
  updated_by: updatedBy,
});

// ─── List FAQ Reviews ─────────────────────────────────────────────────────
export const listFaqReviewsService = async (tenant_id, status, page, limit) => {
  const offset = (page - 1) * limit;
  const persistedPublishedFilter =
    status === "published" ? "AND fk.id IS NOT NULL" : "";

  const dataQuery = `
    SELECT fr.id, fr.question, fr.normalized_question, fr.agent_category, fr.agent_reason,
           fr.doctor_answer, fr.whatsapp_number, fr.status, fr.add_to_kb, fr.is_active,
           fr.reviewed_by, fr.answered_at, fr.deleted_at, fr.created_at, fr.updated_at,
           fk.id AS knowledge_entry_id
    FROM ${tableNames.FAQ_REVIEWS} fr
    LEFT JOIN ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
      ON fk.faq_review_id = fr.id
     AND fk.tenant_id = fr.tenant_id
    WHERE fr.tenant_id = ?
      AND fr.status = ?
      ${persistedPublishedFilter}
    ORDER BY fr.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM ${tableNames.FAQ_REVIEWS} fr
    LEFT JOIN ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
      ON fk.faq_review_id = fr.id
     AND fk.tenant_id = fr.tenant_id
    WHERE fr.tenant_id = ?
      AND fr.status = ?
      ${persistedPublishedFilter}
  `;

  const [reviews] = await db.sequelize.query(dataQuery, {
    replacements: [tenant_id, status, limit, offset],
  });

  const [countRows] = await db.sequelize.query(countQuery, {
    replacements: [tenant_id, status],
  });

  return {
    reviews,
    total: countRows[0]?.total || 0,
    page,
    limit,
  };
};

// ─── FAQ Counts ───────────────────────────────────────────────────────────
export const getFaqCountsService = async (tenant_id) => {
  const [rows] = await db.sequelize.query(
    `
    SELECT status, COUNT(*) AS count
    FROM ${tableNames.FAQ_REVIEWS}
    WHERE tenant_id = ?
    GROUP BY status
    `,
    { replacements: [tenant_id] },
  );

  const counts = { pending_review: 0, published: 0, deleted: 0 };
  for (const row of rows) {
    counts[row.status] = Number(row.count);
  }
  return counts;
};

// ─── Get Master FAQ Source ────────────────────────────────────────────────
export const getFaqMasterSourceService = async (tenant_id) => {
  const canonicalSource = await ensureFaqMasterSource(tenant_id);
  if (!canonicalSource?.id) return null;

  try {
    await syncFaqKnowledgeChunksIfStale(tenant_id, canonicalSource.id);
  } catch (err) {
    console.error("[FAQ-MASTER] Failed to sync FAQ chunks:", err.message);
  }

  const [rows] = await db.sequelize.query(
    `
    SELECT ks.id, ks.title, ks.type, ks.status,
           (ks.status = 'active') AS is_active,
           ks.created_at,
           (SELECT COUNT(*) FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
            WHERE fk.tenant_id = ks.tenant_id
              AND fk.source_id = ks.id
              AND fk.is_active = true) AS published_count
    FROM ${tableNames.KNOWLEDGESOURCE} ks
    WHERE ks.tenant_id = ?
      AND ks.id = ?
      AND ks.is_deleted = false
    LIMIT 1
    `,
    { replacements: [tenant_id, canonicalSource.id] },
  );

  if (!rows[0]) return null;
  return { source: rows[0], published_count: Number(rows[0].published_count) };
};

// ─── Save Draft (update question / answer) ────────────────────────────────
export const saveFaqDraftService = async (id, tenant_id, question, doctor_answer) => {
  const [rows] = await db.sequelize.query(
    `SELECT id, status FROM ${tableNames.FAQ_REVIEWS}
     WHERE id = ? AND tenant_id = ? AND status != 'deleted'
     LIMIT 1`,
    { replacements: [id, tenant_id] },
  );

  if (!rows.length) return null;

  const fields = [];
  const values = [];

  if (question !== undefined) {
    fields.push("question = ?");
    values.push(question);
  }
  if (doctor_answer !== undefined) {
    fields.push("doctor_answer = ?");
    values.push(doctor_answer);
  }
  if (!fields.length) return rows[0];

  fields.push("updated_at = NOW()");
  values.push(id, tenant_id);

  await db.sequelize.query(
    `UPDATE ${tableNames.FAQ_REVIEWS}
     SET ${fields.join(", ")}
     WHERE id = ? AND tenant_id = ?`,
    { replacements: values },
  );

  const [updated] = await db.sequelize.query(
    `SELECT * FROM ${tableNames.FAQ_REVIEWS} WHERE id = ? AND tenant_id = ? LIMIT 1`,
    { replacements: [id, tenant_id] },
  );
  return updated[0] || null;
};

// ─── Publish FAQ ──────────────────────────────────────────────────────────
export const publishFaqService = async (
  id,
  tenant_id,
  reviewed_by,
  payload = {},
) => {
  let masterSourceId = null;

  const result = await db.sequelize.transaction(async (transaction) => {
    const [rows] = await db.sequelize.query(
      `SELECT id, status, doctor_answer, question FROM ${tableNames.FAQ_REVIEWS}
       WHERE id = ? AND tenant_id = ? AND status != 'deleted'
       LIMIT 1
       FOR UPDATE`,
      { replacements: [id, tenant_id], transaction },
    );

    if (!rows.length) return null;

    const resolvedQuestion =
      typeof payload.question === "string" && payload.question.trim()
        ? payload.question.trim()
        : rows[0].question;

    const resolvedAnswer =
      typeof payload.doctor_answer === "string" && payload.doctor_answer.trim()
        ? payload.doctor_answer.trim()
        : rows[0].doctor_answer;

    if (!resolvedAnswer) {
      throw new Error("Cannot publish a FAQ without a doctor answer");
    }

    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_REVIEWS}
       SET question = ?, doctor_answer = ?,
           status = 'published', add_to_kb = true, reviewed_by = ?,
           answered_at = NOW(), updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      {
        replacements: [
          resolvedQuestion,
          resolvedAnswer,
          reviewed_by || null,
          id,
          tenant_id,
        ],
        transaction,
      },
    );

    const masterSource = await ensureFaqMasterSourceInTransaction(
      tenant_id,
      transaction,
    );
    if (!masterSource?.id) {
      throw new Error("FAQ master source is unavailable");
    }

    // Guard: if an admin explicitly disabled the master source, refuse to re-enable it
    if (masterSource.status === "inactive") {
      throw new Error("FAQ_MASTER_DISABLED");
    }

    await db.sequelize.query(
      `UPDATE ${tableNames.KNOWLEDGESOURCE}
       SET is_deleted = false, deleted_at = NULL, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [masterSource.id, tenant_id], transaction },
    );

    const payloadJson = JSON.stringify(
      buildFaqPayload({
        question: resolvedQuestion,
        answer: resolvedAnswer,
        updatedBy: reviewed_by || null,
      }),
    );

    const [updateResult, updateMeta] = await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       SET source_id = ?,
           faq_payload = ?,
           is_active = true,
           updated_at = NOW(),
           updated_by = ?
       WHERE tenant_id = ? AND faq_review_id = ?`,
      {
        replacements: [
          masterSource.id,
          payloadJson,
          reviewed_by || null,
          tenant_id,
          id,
        ],
        transaction,
      },
    );

    const updatedCount = Number(
      updateMeta?.affectedRows || updateResult?.affectedRows || 0,
    );
    if (!updatedCount) {
      await db.sequelize.query(
        `INSERT INTO ${tableNames.FAQ_KNOWLEDGE_SOURCE}
           (tenant_id, source_id, faq_review_id, faq_payload, is_active, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, true, ?, NOW(), NOW())`,
        {
          replacements: [
            tenant_id,
            masterSource.id,
            id,
            payloadJson,
            reviewed_by || null,
          ],
          transaction,
        },
      );
    }

    masterSourceId = masterSource.id;

    const [updated] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.FAQ_REVIEWS} WHERE id = ? AND tenant_id = ? LIMIT 1`,
      { replacements: [id, tenant_id], transaction },
    );
    return updated[0] || null;
  });

  // Phase 2: regenerate embeddings outside the transaction (no lock held during AI call)
  if (result && masterSourceId) {
    await syncFaqKnowledgeChunks(tenant_id, masterSourceId);
  }

  return result;
};

// ─── Create FAQ (Admin Direct Add) ───────────────────────────────────────
export const createFaqService = async (
  tenant_id,
  created_by,
  question,
  answer,
) => {
  if (!question?.trim() || !answer?.trim()) {
    throw new Error("Question and answer are required");
  }

  let masterSourceId = null;

  const result = await db.sequelize.transaction(async (transaction) => {
    const normalizedQuestion = question.trim().toLowerCase();

    const [insertResult] = await db.sequelize.query(
      `INSERT INTO ${tableNames.FAQ_REVIEWS}
         (tenant_id, question, normalized_question, doctor_answer,
          status, add_to_kb, is_active, reviewed_by, answered_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'published', true, true, ?, NOW(), NOW(), NOW())`,
      {
        replacements: [
          tenant_id,
          question.trim(),
          normalizedQuestion,
          answer.trim(),
          created_by || null,
        ],
        transaction,
      },
    );

    const faqReviewId =
      typeof insertResult === "number" ? insertResult : insertResult?.insertId || null;
    if (!faqReviewId) {
      throw new Error("Failed to create FAQ review record");
    }

    const masterSource = await ensureFaqMasterSourceInTransaction(
      tenant_id,
      transaction,
    );
    if (!masterSource?.id) {
      throw new Error("FAQ master source is unavailable");
    }

    await db.sequelize.query(
      `UPDATE ${tableNames.KNOWLEDGESOURCE}
       SET status = 'active', is_deleted = false, deleted_at = NULL, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [masterSource.id, tenant_id], transaction },
    );

    const payloadJson = JSON.stringify(
      buildFaqPayload({
        question: question.trim(),
        answer: answer.trim(),
        updatedBy: created_by || null,
      }),
    );

    await db.sequelize.query(
      `INSERT INTO ${tableNames.FAQ_KNOWLEDGE_SOURCE}
         (tenant_id, source_id, faq_review_id, faq_payload, is_active, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, true, ?, NOW(), NOW())`,
      {
        replacements: [
          tenant_id,
          masterSource.id,
          faqReviewId,
          payloadJson,
          created_by || null,
        ],
        transaction,
      },
    );

    masterSourceId = masterSource.id;

    const [created] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.FAQ_REVIEWS} WHERE id = ? AND tenant_id = ? LIMIT 1`,
      { replacements: [faqReviewId, tenant_id], transaction },
    );
    return created[0] || null;
  });

  // Phase 2: regenerate embeddings outside the transaction (no lock held during AI call)
  if (result && masterSourceId) {
    await syncFaqKnowledgeChunks(tenant_id, masterSourceId);
  }

  return result;
};

// ─── Toggle is_active ─────────────────────────────────────────────────────
// desiredActive: explicit boolean from caller, or undefined to flip current value
export const toggleFaqActiveService = async (id, tenant_id, desiredActive) => {
  let sourceIdForSync = null;

  const result = await db.sequelize.transaction(async (transaction) => {
    const [rows] = await db.sequelize.query(
      `SELECT fr.id, fr.status, fr.is_active, fk.source_id
       FROM ${tableNames.FAQ_REVIEWS} fr
       LEFT JOIN ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
         ON fk.faq_review_id = fr.id AND fk.tenant_id = fr.tenant_id
       WHERE fr.id = ? AND fr.tenant_id = ? AND fr.status = 'published'
       LIMIT 1
       FOR UPDATE`,
      { replacements: [id, tenant_id], transaction },
    );

    if (!rows.length) return null;

    // Use the caller's explicit desired value; fall back to flip if not provided
    const newActive =
      desiredActive !== undefined ? Boolean(desiredActive) : !rows[0].is_active;

    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_REVIEWS}
       SET is_active = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [newActive, id, tenant_id], transaction },
    );

    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       SET is_active = ?, updated_at = NOW()
       WHERE faq_review_id = ? AND tenant_id = ?`,
      { replacements: [newActive, id, tenant_id], transaction },
    );

    sourceIdForSync = rows[0].source_id || null;

    const [updated] = await db.sequelize.query(
      `SELECT * FROM ${tableNames.FAQ_REVIEWS} WHERE id = ? AND tenant_id = ? LIMIT 1`,
      { replacements: [id, tenant_id], transaction },
    );
    return updated[0] || null;
  });

  // Phase 2: regenerate embeddings outside the transaction (no lock held during AI call)
  if (result && sourceIdForSync) {
    await syncFaqKnowledgeChunks(tenant_id, sourceIdForSync);
  }

  return result;
};

// ─── Soft Delete ──────────────────────────────────────────────────────────
export const softDeleteFaqService = async (id, tenant_id) => {
  let sourceIdForSync = null;

  const deleted = await db.sequelize.transaction(async (transaction) => {
    const [rows] = await db.sequelize.query(
      `SELECT fr.id, fk.source_id
       FROM ${tableNames.FAQ_REVIEWS} fr
       LEFT JOIN ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
         ON fk.faq_review_id = fr.id AND fk.tenant_id = fr.tenant_id
       WHERE fr.id = ? AND fr.tenant_id = ? AND fr.status != 'deleted'
       LIMIT 1
       FOR UPDATE`,
      { replacements: [id, tenant_id], transaction },
    );

    if (!rows.length) return false;

    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_REVIEWS}
       SET status = 'deleted', add_to_kb = false, is_active = false,
           deleted_at = NOW(), updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction },
    );

    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       SET is_active = false, updated_at = NOW()
       WHERE faq_review_id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction },
    );

    sourceIdForSync = rows[0].source_id || null;
    return true;
  });

  // Phase 2: regenerate embeddings outside the transaction (no lock held during AI call)
  if (deleted && sourceIdForSync) {
    await syncFaqKnowledgeChunks(tenant_id, sourceIdForSync);
  }

  return deleted;
};

// ─── List Published FAQ Knowledge Entries (child records) ────────────────
export const listFaqKnowledgeEntriesService = async (tenant_id, page, limit) => {
  const offset = (page - 1) * limit;

  const [entries] = await db.sequelize.query(
    `SELECT fk.id, fk.faq_review_id, 
            JSON_UNQUOTE(JSON_EXTRACT(fk.faq_payload, '$.question')) AS question,
            JSON_UNQUOTE(JSON_EXTRACT(fk.faq_payload, '$.answer')) AS answer,
            fk.is_active,
            fk.updated_by, fk.updated_at, fk.created_at
     FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
     WHERE fk.tenant_id = ?
     ORDER BY fk.created_at DESC
     LIMIT ? OFFSET ?`,
    { replacements: [tenant_id, limit, offset] },
  );

  const [[{ total }]] = await db.sequelize.query(
    `SELECT COUNT(*) AS total FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE} WHERE tenant_id = ?`,
    { replacements: [tenant_id] },
  );

  return { entries, total: Number(total), page, limit };
};

// ─── Get Single FAQ Knowledge Entry ──────────────────────────────────────
export const getFaqKnowledgeEntryService = async (id, tenant_id) => {
  const [rows] = await db.sequelize.query(
    `SELECT fk.id, fk.faq_review_id, 
            JSON_UNQUOTE(JSON_EXTRACT(fk.faq_payload, '$.question')) AS question,
            JSON_UNQUOTE(JSON_EXTRACT(fk.faq_payload, '$.answer')) AS answer,
            fk.is_active,
            fk.updated_by, fk.updated_at, fk.created_at
     FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
     WHERE fk.id = ? AND fk.tenant_id = ?
     LIMIT 1`,
    { replacements: [id, tenant_id] },
  );
  return rows[0] || null;
};

// ─── Edit FAQ Knowledge Entry ─────────────────────────────────────────────
export const editFaqKnowledgeEntryService = async (
  id,
  tenant_id,
  { question, answer, updated_by },
) => {
  let sourceIdForSync = null;

  const result = await db.sequelize.transaction(async (transaction) => {
    const [rows] = await db.sequelize.query(
      `SELECT id, faq_review_id, source_id, faq_payload
       FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       WHERE id = ? AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      { replacements: [id, tenant_id], transaction },
    );

    if (!rows.length) return null;

    let currentPayload = {};
    try {
      currentPayload = rows[0].faq_payload
        ? typeof rows[0].faq_payload === "string"
          ? JSON.parse(rows[0].faq_payload)
          : rows[0].faq_payload
        : {};
    } catch (err) {
      currentPayload = {};
    }

    const updatedQuestion =
      question !== undefined ? question : currentPayload.question;
    const updatedAnswer = answer !== undefined ? answer : currentPayload.answer;

    const nextPayload = {
      ...currentPayload,
      ...buildFaqPayload({
        question: updatedQuestion,
        answer: updatedAnswer,
        updatedBy: updated_by || currentPayload.updated_by || null,
      }),
    };

    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       SET faq_payload = ?,
           updated_at = NOW(),
           updated_by = ?
       WHERE id = ? AND tenant_id = ?`,
      {
        replacements: [
          JSON.stringify(nextPayload),
          updated_by || null,
          id,
          tenant_id,
        ],
        transaction,
      },
    );

    const syncFields = [];
    const syncValues = [];
    if (question !== undefined) {
      syncFields.push("question = ?");
      syncValues.push(question);
    }
    if (answer !== undefined) {
      syncFields.push("doctor_answer = ?");
      syncValues.push(answer);
    }
    if (syncFields.length) {
      syncFields.push("updated_at = NOW()");
      syncValues.push(rows[0].faq_review_id, tenant_id);
      await db.sequelize.query(
        `UPDATE ${tableNames.FAQ_REVIEWS}
         SET ${syncFields.join(", ")}
         WHERE id = ? AND tenant_id = ?`,
        { replacements: syncValues, transaction },
      );
    }

    sourceIdForSync = rows[0].source_id || null;

    const [updated] = await db.sequelize.query(
      `SELECT id, faq_review_id,
              JSON_UNQUOTE(JSON_EXTRACT(faq_payload, '$.question')) AS question,
              JSON_UNQUOTE(JSON_EXTRACT(faq_payload, '$.answer')) AS answer,
              is_active, updated_by, updated_at, created_at
       FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       WHERE id = ? AND tenant_id = ?
       LIMIT 1`,
      { replacements: [id, tenant_id], transaction },
    );
    return updated[0] || null;
  });

  // Phase 2: regenerate embeddings outside the transaction (no lock held during AI call)
  if (result && sourceIdForSync) {
    await syncFaqKnowledgeChunks(tenant_id, sourceIdForSync);
  }

  return result;
};

// ─── Remove FAQ Knowledge Entry (soft — deactivates AI retrieval) ─────────
export const removeFaqKnowledgeEntryService = async (id, tenant_id) => {
  let sourceIdForSync = null;

  const removed = await db.sequelize.transaction(async (transaction) => {
    const [rows] = await db.sequelize.query(
      `SELECT id, source_id, faq_review_id
       FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       WHERE id = ? AND tenant_id = ?
       LIMIT 1
       FOR UPDATE`,
      { replacements: [id, tenant_id], transaction },
    );

    if (!rows.length) return false;

    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_KNOWLEDGE_SOURCE}
       SET is_active = false, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [id, tenant_id], transaction },
    );

    await db.sequelize.query(
      `UPDATE ${tableNames.FAQ_REVIEWS}
       SET is_active = false, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      { replacements: [rows[0].faq_review_id, tenant_id], transaction },
    );

    sourceIdForSync = rows[0].source_id || null;
    return true;
  });

  // Phase 2: regenerate embeddings outside the transaction (no lock held during AI call)
  if (removed && sourceIdForSync) {
    await syncFaqKnowledgeChunks(tenant_id, sourceIdForSync);
  }

  return removed;
};
