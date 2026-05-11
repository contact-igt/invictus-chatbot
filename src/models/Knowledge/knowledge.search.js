import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import {
  cosineSimilarity,
  generateTextEmbedding,
  parseEmbedding,
} from "../../utils/ai/embedding.js";

const MAX_CANDIDATE_CHUNKS = Number(
  process.env.KNOWLEDGE_SEARCH_MAX_CANDIDATES || 800,
);
const MAX_RETURNED_CHUNKS = Number(
  process.env.KNOWLEDGE_SEARCH_TOP_K || 12,
);
const SIMILARITY_THRESHOLD = Number(
  process.env.KNOWLEDGE_SEARCH_MIN_SIMILARITY || 0.12,
);
const MAX_EMBEDDING_BACKFILL_PER_QUERY = Number(
  process.env.KNOWLEDGE_EMBEDDING_BACKFILL_LIMIT || 200,
);

const BACKFILL_MAX_RETRIES = 3;
const BACKFILL_BASE_DELAY_MS = 500;

const backfillDelay = (ms) => new Promise((r) => setTimeout(r, ms));

const generateEmbeddingWithBackfillRetry = async (text, tenantId) => {
  for (let attempt = 1; attempt <= BACKFILL_MAX_RETRIES; attempt++) {
    try {
      const result = await generateTextEmbedding(text, tenantId);
      if (result && Array.isArray(result) && result.length > 0) return result;
    } catch (err) {
      console.warn(`[KNOWLEDGE-BACKFILL] Embedding attempt ${attempt}/${BACKFILL_MAX_RETRIES} failed: ${err.message}`);
    }
    if (attempt < BACKFILL_MAX_RETRIES) {
      await backfillDelay(BACKFILL_BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }
  return null;
};

const hydrateMissingEmbeddings = async (rows, tenant_id) => {
  if (!Array.isArray(rows) || !rows.length) return rows;

  let backfilledCount = 0;

  for (const row of rows) {
    const parsed = parseEmbedding(row.embedding);
    if (parsed) {
      row.embedding_vector = parsed;
      continue;
    }

    if (backfilledCount >= MAX_EMBEDDING_BACKFILL_PER_QUERY) continue;

    const generated = await generateEmbeddingWithBackfillRetry(
      row.chunk_text,
      tenant_id,
    );
    if (!generated) {
      console.warn(
        `[KNOWLEDGE-BACKFILL] chunk ${row.chunk_id}: embedding failed after ${BACKFILL_MAX_RETRIES} retries`,
      );
      continue;
    }

    row.embedding_vector = generated;
    row.embedding = generated;
    backfilledCount += 1;

    await db.sequelize.query(
      `UPDATE ${tableNames.KNOWLEDGECHUNKS}
       SET embedding = ?, updated_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      {
        replacements: [JSON.stringify(generated), row.chunk_id, tenant_id],
      },
    );
    console.log(
      `[KNOWLEDGE-BACKFILL] chunk ${row.chunk_id}: embedding backfilled OK (${generated.length}d)`,
    );
  }

  return rows;
};

const fetchActiveCandidateChunks = async (tenant_id) => {
  const baseQuery = `
    SELECT kc.id AS chunk_id, kc.chunk_text, kc.embedding,
           ks.id AS source_id, ks.title AS source_title, ks.type AS source_type
    FROM ${tableNames.KNOWLEDGECHUNKS} kc
    INNER JOIN ${tableNames.KNOWLEDGESOURCE} ks
      ON ks.id = kc.source_id
    WHERE ks.status = 'active'
      AND ks.is_deleted = false
      AND kc.is_deleted = false
      AND ks.tenant_id = ?
    LIMIT ?
  `;

  try {
    const [rows] = await db.sequelize.query(baseQuery, {
      replacements: [tenant_id, MAX_CANDIDATE_CHUNKS],
    });
    return rows;
  } catch (queryErr) {
    console.error("[KNOWLEDGE-SEARCH] Primary semantic query failed:", queryErr.message);

    const fallbackQuery = `
      SELECT kc.id AS chunk_id, kc.chunk_text, kc.embedding,
             ks.id AS source_id, ks.title AS source_title, ks.type AS source_type
      FROM ${tableNames.KNOWLEDGECHUNKS} kc
      INNER JOIN ${tableNames.KNOWLEDGESOURCE} ks
        ON ks.id = kc.source_id
      WHERE ks.status = 'active'
        AND ks.is_deleted = false
        AND ks.tenant_id = ?
      LIMIT ?
    `;

    const [rows] = await db.sequelize.query(fallbackQuery, {
      replacements: [tenant_id, MAX_CANDIDATE_CHUNKS],
    });
    return rows;
  }
};

export const searchKnowledgeChunks = async (tenant_id, question) => {
  if (!tenant_id || !question)
    return { chunks: [], resolvedLogs: [], sources: [] };

  let questionEmbedding = null;
  try {
    questionEmbedding = await generateTextEmbedding(question, tenant_id);
  } catch (embErr) {
    console.error(`[KNOWLEDGE-SEARCH] Embedding generation failed: ${embErr.message}`);
  }
  if (!questionEmbedding) {
    return { chunks: [], resolvedLogs: [], sources: [] };
  }

  const candidateRows = await fetchActiveCandidateChunks(tenant_id);
  if (!candidateRows.length) {
    return { chunks: [], resolvedLogs: [], sources: [] };
  }

  const hydratedRows = await hydrateMissingEmbeddings(candidateRows, tenant_id);

  const scoredRows = hydratedRows
    .map((row) => {
      const embedding = row.embedding_vector || parseEmbedding(row.embedding);
      if (!embedding) return null;

      return {
        ...row,
        similarity: cosineSimilarity(questionEmbedding, embedding),
      };
    })
    .filter((row) => row && Number.isFinite(row.similarity))
    .sort((a, b) => b.similarity - a.similarity);

  const allRows = scoredRows
    .filter((row) => row.similarity >= SIMILARITY_THRESHOLD)
    .slice(0, MAX_RETURNED_CHUNKS);

  if (!allRows.length) {
    return { chunks: [], resolvedLogs: [], sources: [] };
  }

  // Group chunks by source for UI transparency
  const sourceMap = new Map();
  allRows.forEach((r) => {
    if (!sourceMap.has(r.source_id)) {
      sourceMap.set(r.source_id, {
        id: r.source_id,
        title: r.source_title,
        type: r.source_type,
        chunks: [],
      });
    }
    sourceMap.get(r.source_id).chunks.push(r.chunk_text);
  });

  return {
    chunks: allRows.map((r) => r.chunk_text),
    resolvedLogs: [],
    sources: Array.from(sourceMap.values()),
  };
};
