import OpenAI from "openai";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { SEARCH_REFINE_PROMPT } from "../../utils/ai/prompts/index.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Uses a fast LLM to refine a user's question into optimized search keywords.
 */
export const analyzeQuestionForSearch = async (question) => {
  try {
    const prompt = SEARCH_REFINE_PROMPT.replace("{QUESTION}", question);

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 50,
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error("[AI-SEARCH-REFINE] Error:", err.message);
    return "";
  }
};

export const searchKnowledgeChunks = async (tenant_id, question) => {
  if (!tenant_id || !question) return [];

  // Step 1: AI-Refined Keywords (Query Expansion)
  const aiKeywords = await analyzeQuestionForSearch(question);

  // Step 2: Traditional Keyword Extraction
  const STOP_WORDS = [
    "who", "what", "is", "are", "the", "this", "that", "about", "tell", "me", "please", "explain",
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

  if (!keywords.length) return [];

  const conditions = keywords.map(() => "kc.chunk_text LIKE ?").join(" OR ");
  const values = keywords.map((k) => `%${k}%`);

  /* 1️⃣ Search Main Knowledge Base */
  const query = `
    SELECT kc.chunk_text
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

  const [knowledgeRows] = await db.sequelize.query(query, {
    replacements: [tenant_id, ...values],
  });

  /* 2️⃣ Search Resolved AI Logs (Real-time Feedback Loop) */
  const logConditions = keywords.map(() => "(user_message LIKE ? OR resolution LIKE ? OR payload LIKE ?)").join(" OR ");
  const logValues = [];
  keywords.forEach(k => {
    logValues.push(`%${k}%`);
    logValues.push(`%${k}%`);
    logValues.push(`%${k}%`);
  });

  const logQuery = `
    SELECT user_message, resolution
    FROM ${tableNames.AI_ANALYSIS_LOGS}
    WHERE tenant_id IN (?)
      AND status = 'resolved'
      AND (${logConditions})
    ORDER BY created_at DESC
    LIMIT 5
  `;

  const [logRows] = await db.sequelize.query(logQuery, {
    replacements: [tenant_id, ...logValues],
  });

  // Combine both results (Prioritize Logs/Resolutions first)
  const allResults = [
    ...logRows.map((r) => `[Previous Question]: ${r.user_message}\n[Admin Resolution]: ${r.resolution}`),
    ...knowledgeRows.map((r) => r.chunk_text)
  ];

  return allResults;
};
