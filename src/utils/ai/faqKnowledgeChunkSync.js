import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateTextEmbedding } from "./embedding.js";

const parsePayload = (rawPayload) => {
  if (!rawPayload) return null;

  try {
    const payload =
      typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;

    if (!payload || typeof payload !== "object") return null;
    return payload;
  } catch (err) {
    return null;
  }
};

const buildFaqChunkText = (payload = {}, row = {}) => {
  const question = String(payload.question || "").trim();
  const answer = String(payload.answer || "").trim();
  if (!question || !answer) return null;

  const publishedStatus = payload.published_status || "published";
  const source = payload.source || "doctor_faq";
  const updatedAt =
    payload.updated_at || row.updated_at || row.created_at || new Date().toISOString();

  return [
    "Doctor FAQ Knowledge",
    `Question: ${question}`,
    `Answer: ${answer}`,
    `Published Status: ${publishedStatus}`,
    `Source: ${source}`,
    `Updated At: ${updatedAt}`,
  ].join("\n");
};

export const syncFaqKnowledgeChunks = async (
  tenant_id,
  source_id,
  transaction = null,
) => {
  if (!tenant_id || !source_id) return;

  const [rows] = await db.sequelize.query(
    `SELECT id, faq_payload, updated_at, created_at
     FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE}
     WHERE tenant_id = ?
       AND source_id = ?
       AND is_active = true
       AND faq_payload IS NOT NULL
     ORDER BY id ASC`,
    { replacements: [tenant_id, source_id], transaction },
  );

  await db.sequelize.query(
    `DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
     WHERE tenant_id = ? AND source_id = ?`,
    { replacements: [tenant_id, source_id], transaction },
  );

  for (const row of rows) {
    const payload = parsePayload(row.faq_payload);
    const chunkText = buildFaqChunkText(payload || {}, row);
    if (!chunkText) continue;

    const embedding = await generateTextEmbedding(chunkText, tenant_id);

    await db.sequelize.query(
      `INSERT INTO ${tableNames.KNOWLEDGECHUNKS}
         (tenant_id, source_id, chunk_text, embedding, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, false, NOW(), NOW())`,
      {
        replacements: [
          tenant_id,
          source_id,
          chunkText,
          JSON.stringify(embedding || []),
        ],
        transaction,
      },
    );
  }
};

export const syncFaqKnowledgeChunksIfStale = async (
  tenant_id,
  source_id,
  transaction = null,
) => {
  if (!tenant_id || !source_id) return;

  const [[faqMeta]] = await db.sequelize.query(
    `SELECT COUNT(*) AS active_faq_count,
            MAX(COALESCE(updated_at, created_at)) AS latest_faq_update
     FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE}
     WHERE tenant_id = ? AND source_id = ? AND is_active = true`,
    { replacements: [tenant_id, source_id], transaction },
  );

  const [[chunkMeta]] = await db.sequelize.query(
    `SELECT COUNT(*) AS chunk_count,
            MAX(updated_at) AS latest_chunk_update
     FROM ${tableNames.KNOWLEDGECHUNKS}
     WHERE tenant_id = ? AND source_id = ?`,
    { replacements: [tenant_id, source_id], transaction },
  );

  const activeFaqCount = Number(faqMeta?.active_faq_count || 0);
  const chunkCount = Number(chunkMeta?.chunk_count || 0);

  const latestFaqUpdate = faqMeta?.latest_faq_update
    ? new Date(faqMeta.latest_faq_update).getTime()
    : 0;
  const latestChunkUpdate = chunkMeta?.latest_chunk_update
    ? new Date(chunkMeta.latest_chunk_update).getTime()
    : 0;

  const isStale =
    activeFaqCount !== chunkCount || latestChunkUpdate < latestFaqUpdate;

  if (isStale) {
    await syncFaqKnowledgeChunks(tenant_id, source_id, transaction);
  }
};
