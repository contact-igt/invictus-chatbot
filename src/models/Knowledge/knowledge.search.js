import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { SEARCH_REFINE_PROMPT } from "../../utils/ai/prompts/index.js";
import { callAI } from "../../utils/ai/coreAi.js";

/**
 * Uses a fast LLM to refine a user's question into optimized search keywords.
 */
export const analyzeQuestionForSearch = async (question, tenant_id = null) => {
  try {
    const prompt = SEARCH_REFINE_PROMPT.replace("{QUESTION}", question);

    const result = await callAI({
      messages: [{ role: "user", content: prompt }],
      tenant_id,
      source: "knowledge_search",
      temperature: 0,
    });

    return result.content;
  } catch (err) {
    console.error("[AI-SEARCH-REFINE] Error:", err.message);
    return "";
  }
};

export const searchKnowledgeChunks = async (tenant_id, question) => {
  if (!tenant_id || !question)
    return { chunks: [], resolvedLogs: [], sources: [] };

  // Step 1: AI-Refined Keywords (Query Expansion)
  const aiKeywords = await analyzeQuestionForSearch(question, tenant_id);

  // Step 2: Traditional Keyword Extraction
  const STOP_WORDS = [
    "who",
    "what",
    "is",
    "are",
    "the",
    "this",
    "that",
    "about",
    "tell",
    "me",
    "please",
    "explain",
  ];

  const manualKeywords = question
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Replace punctuation with space to avoid merging words
    .split(/\s+/) // Split by any whitespace
    .filter((w) => w.length > 2 && !STOP_WORDS.includes(w));

  const refinedKeywords = aiKeywords
    ? aiKeywords
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    : [];

  // Combine both (favoring unique terms)
  const keywords = [...new Set([...manualKeywords, ...refinedKeywords])];

  if (!keywords.length) return { chunks: [], resolvedLogs: [], sources: [] };

  const conditions = keywords.map(() => "kc.chunk_text LIKE ?").join(" OR ");
  const values = keywords.map((k) => `%${k}%`);

  /* 1️⃣ Search Main Knowledge Base */
  const query = `
    SELECT kc.chunk_text, ks.id as source_id, ks.title as source_title, ks.type as source_type
    FROM ${tableNames.KNOWLEDGECHUNKS} kc
    INNER JOIN ${tableNames.KNOWLEDGESOURCE} ks
      ON ks.id = kc.source_id
    WHERE ks.status = 'active'
      AND ks.is_deleted = false
      AND kc.is_deleted = false
      AND ks.tenant_id IN (?)
      AND (${conditions})
    ORDER BY LENGTH(kc.chunk_text) ASC
    LIMIT 10
  `;

  let knowledgeRows = [];
  try {
    const [rows] = await db.sequelize.query(query, {
      replacements: [tenant_id, ...values],
    });
    knowledgeRows = rows;
  } catch (queryErr) {
    // Fallback: try without kc.is_deleted filter (column may not exist in older DBs)
    console.error("[KNOWLEDGE-SEARCH] Primary query failed:", queryErr.message);
    try {
      const fallbackQuery = `
        SELECT kc.chunk_text, ks.id as source_id, ks.title as source_title, ks.type as source_type
        FROM ${tableNames.KNOWLEDGECHUNKS} kc
        INNER JOIN ${tableNames.KNOWLEDGESOURCE} ks
          ON ks.id = kc.source_id
        WHERE ks.status = 'active'
          AND ks.is_deleted = false
          AND ks.tenant_id IN (?)
          AND (${conditions})
        ORDER BY LENGTH(kc.chunk_text) ASC
        LIMIT 10
      `;
      const [rows] = await db.sequelize.query(fallbackQuery, {
        replacements: [tenant_id, ...values],
      });
      knowledgeRows = rows;
    } catch (fallbackErr) {
      console.error(
        "[KNOWLEDGE-SEARCH] Fallback query also failed:",
        fallbackErr.message,
      );
    }
  }

  // Group chunks by source for UI transparency
  const sourceMap = new Map();
  knowledgeRows.forEach((r) => {
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
    chunks: knowledgeRows.map((r) => r.chunk_text),
    resolvedLogs: [],
    sources: Array.from(sourceMap.values()),
  };
};
