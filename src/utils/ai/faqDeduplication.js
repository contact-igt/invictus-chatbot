import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { cosineSimilarity, parseEmbedding } from "./embedding.js";

/**
 * FAQ Semantic Deduplication — 2-tier threshold system
 *
 * score >= 0.60 → MATCH (merge into existing card, increment count)
 * score <  0.60 → NEW card (create fresh)
 *
 * This catches:
 *   - Exact/near-exact matches (>= 0.80): "AI law teachers names?" → auto-merge
 *   - Similar meaning (>= 0.60): "Who is AI law course teacher?" → merge
 *   - Below 0.60: genuinely different question → new card
 *
 * Override via env: FAQ_DEDUPE_THRESHOLD=0.60
 */
const DEDUPE_THRESHOLD = Number(process.env.FAQ_DEDUPE_THRESHOLD || 0.60);

const dedupeLog = (label, data) =>
  process.stdout.write(`[FAQ-DEDUP] ${label} ${JSON.stringify(data)}\n`);

/**
 * @param {string} tenant_id
 * @param {number[]} questionEmbedding
 * @returns {{ match: {id, question, ask_count, similarity} | null }}
 */
export const findSemanticDuplicateFaq = async (tenant_id, questionEmbedding) => {
  if (!tenant_id) {
    dedupeLog("ERROR: missing tenant_id", {});
    throw new Error("[FAQ-DEDUP] tenant_id is required");
  }
  if (!questionEmbedding || !Array.isArray(questionEmbedding) || questionEmbedding.length === 0) {
    dedupeLog("ERROR: missing or invalid embedding vector", { tenant_id, type: typeof questionEmbedding, length: questionEmbedding?.length });
    throw new Error("[FAQ-DEDUP] Valid embedding vector is required for deduplication");
  }

  const [rows] = await db.sequelize.query(
    `SELECT id, question, ask_count, embedding
     FROM ${tableNames.FAQ_REVIEWS}
     WHERE tenant_id = ?
       AND status != 'deleted'
       AND embedding IS NOT NULL
     ORDER BY id ASC`,
    { replacements: [tenant_id] },
  );

  dedupeLog("Searching existing FAQ vectors", { count: rows.length, threshold: DEDUPE_THRESHOLD, tenant_id });

  if (!rows.length) {
    dedupeLog("0 existing FAQ vectors — first question for this tenant, will create new card", { tenant_id });
    return { match: null };
  }

  let bestMatch = null;
  let bestSimilarity = -1;
  let parsedCount = 0;

  for (const row of rows) {
    const rowEmbedding = parseEmbedding(row.embedding);
    if (!rowEmbedding) {
      dedupeLog("WARNING: could not parse embedding for FAQ", { id: row.id, q: String(row.question || "").substring(0, 40) });
      continue;
    }
    parsedCount++;

    const similarity = cosineSimilarity(questionEmbedding, rowEmbedding);
    dedupeLog("score", {
      id: row.id,
      score: Math.round(similarity * 1000) / 1000,
      q: String(row.question || "").substring(0, 60),
    });

    if (similarity > bestSimilarity) {
      bestMatch = row;
      bestSimilarity = similarity;
    }
  }

  // Log top match clearly
  if (bestMatch) {
    dedupeLog("Top match", {
      question: String(bestMatch.question || "").substring(0, 80),
      score: Math.round(bestSimilarity * 1000) / 1000,
    });
  }

  // Log threshold decision
  const isMatch = bestSimilarity >= DEDUPE_THRESHOLD;
  dedupeLog(`Score ${Math.round(bestSimilarity * 1000) / 1000} vs threshold ${DEDUPE_THRESHOLD} → match: ${isMatch}`, {
    bestId: bestMatch?.id ?? null,
    parsedVectors: parsedCount,
    totalRows: rows.length,
  });

  if (!bestMatch || !isMatch) return { match: null };

  dedupeLog("✓ MERGE — will increment count", {
    existingId: bestMatch.id,
    existingQuestion: String(bestMatch.question || "").substring(0, 60),
    currentCount: Number(bestMatch.ask_count ?? 1),
    similarity: Math.round(bestSimilarity * 1000) / 1000,
  });

  return {
    match: {
      id: bestMatch.id,
      question: String(bestMatch.question || ""),
      ask_count: Number(bestMatch.ask_count ?? 1),
      similarity: bestSimilarity,
    },
  };
};
