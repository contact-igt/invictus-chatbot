import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { generateTextEmbedding } from "./embedding.js";

const EMBED_MAX_RETRIES = 3;
const EMBED_BASE_DELAY_MS = 500;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generates an embedding with exponential-backoff retry.
 * Returns the embedding array on success, or null after all retries exhausted.
 */
const generateEmbeddingWithRetry = async (text, tenantId) => {
  for (let attempt = 1; attempt <= EMBED_MAX_RETRIES; attempt++) {
    try {
      const result = await generateTextEmbedding(text, tenantId);
      if (result && Array.isArray(result) && result.length > 0) return result;
    } catch (err) {
      console.warn(`[FAQ-SYNC] Embedding attempt ${attempt}/${EMBED_MAX_RETRIES} failed: ${err.message}`);
    }
    if (attempt < EMBED_MAX_RETRIES) {
      await delay(EMBED_BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }
  return null;
};

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

  let synced = 0;
  for (const row of rows) {
    const payload = parsePayload(row.faq_payload);
    const chunkText = buildFaqChunkText(payload || {}, row);
    if (!chunkText) continue;

    const embedding = await generateEmbeddingWithRetry(chunkText, tenant_id);

    if (!embedding) {
      console.error(
        `[FAQ-SYNC] Row ${row.id}: embedding FAILED after ${EMBED_MAX_RETRIES} retries — skipped`,
      );
      continue;
    }

    await db.sequelize.query(
      `INSERT INTO ${tableNames.KNOWLEDGECHUNKS}
         (tenant_id, source_id, chunk_text, embedding, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, false, NOW(), NOW())`,
      {
        replacements: [
          tenant_id,
          source_id,
          chunkText,
          JSON.stringify(embedding),
        ],
        transaction,
      },
    );
    synced += 1;
    