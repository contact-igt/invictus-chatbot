import OpenAI from "openai";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { searchKnowledgeChunks } from "../Knowledge/knowledge.search.js";
import { getActivePromptService } from "../AiPrompt/aiprompt.service.js";
import { processResponse } from "../../utils/ai/aiTagHandlers/index.js";
import { classifyResponse } from "../../utils/ai/responseClassifier.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Search knowledge chunks and return them WITH their source info (title, type, id)
 * so we can show which knowledge base articles were referenced.
 */
export const searchKnowledgeChunksWithSources = async (tenant_id, question) => {
  if (!tenant_id || !question) return { chunks: [], sources: [] };

  // Reuse the existing keyword extraction logic
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
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.includes(w));

  // AI keyword refinement
  let refinedKeywords = [];
  try {
    const prompt = `Analyze the following customer question and provide a space-separated list of 3-5 key search terms.
    Focus on main topic, synonyms, and intent.
    Question: "${question}"
    Keywords:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 50,
    });

    const aiKeywords = response.choices[0].message.content.trim();
    refinedKeywords = aiKeywords
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  } catch (err) {
    console.error("[PLAYGROUND-SEARCH] AI keyword error:", err.message);
  }

  const keywords = [...new Set([...manualKeywords, ...refinedKeywords])];
  if (!keywords.length) return { chunks: [], sources: [] };

  const conditions = keywords.map(() => "kc.chunk_text LIKE ?").join(" OR ");
  const values = keywords.map((k) => `%${k}%`);

  // Search with source info joined
  const query = `
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

  const [rows] = await db.sequelize.query(query, {
    replacements: [tenant_id, ...values],
  });

  // Extract unique sources WITH their chunk texts grouped
  const sourceMap = new Map();
  rows.forEach((r) => {
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
    chunks: rows.map((r) => r.chunk_text),
    sources: Array.from(sourceMap.values()),
  };
};

/**
 * Main playground chat service.
 * Takes a user message + conversation history, runs it through AI with knowledge base,
 * and returns the response along with knowledge sources used.
 */
export const playgroundChatService = async (
  tenant_id,
  message,
  conversationHistory = [],
) => {
  try {
    const now = new Date();

    const currentDateFormatted = now.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    const currentDayFormatted = now.toLocaleDateString("en-US", {
      weekday: "long",
    });

    const currentTimeFormatted = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    // Get active prompt for this tenant
    const hospitalPrompt =
      (await getActivePromptService(tenant_id)) ||
      "You are a professional customer support assistant.";

    // Search knowledge base WITH source tracking
    const { chunks, sources } = await searchKnowledgeChunksWithSources(
      tenant_id,
      message,
    );

    const knowledgeContext =
      chunks && chunks.length > 0
        ? chunks.join("\n\n")
        : "No relevant uploaded documents.";

    // Search resolved AI logs for additional context
    let resolvedContext = "";
    try {
      const logKeywords = message
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2);

      if (logKeywords.length > 0) {
        const logConditions = logKeywords
          .map(() => "(user_message LIKE ? OR resolution LIKE ?)")
          .join(" OR ");
        const logValues = [];
        logKeywords.forEach((k) => {
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

        if (logRows.length > 0) {
          resolvedContext = logRows
            .map(
              (log) =>
                `[Previous Question]: ${log.user_message}\n[Admin Resolution]: ${log.resolution}`,
            )
            .join("\n\n");
        }
      }
    } catch (err) {
      console.error("[PLAYGROUND] Resolved logs error:", err.message);
    }

    const combinedKnowledge = `
${knowledgeContext}

${
  resolvedContext
    ? `
────────────────────────────────
RESOLVED PAST QUESTIONS (HIGH PRIORITY)
────────────────────────────────
Use these past resolutions to answer if the user's question matches:

${resolvedContext}
`
    : ""
}
`;

    const systemPrompt = `
You are a WhatsApp front-desk reception assistant in a playground/testing environment.

Your role:
- Act like a real human support or front-desk executive
- Be polite, calm, respectful, and supportive
- Use simple, easy-to-understand words
- Sound natural and professional (not robotic, not an AI)

────────────────────────────────
GLOBAL BEHAVIOUR RULES
────────────────────────────────
- Always read the FULL conversation history before replying.
- Understand the user's intent from all recent messages.
- Never repeat questions that were already asked or answered.
- Ask ONLY one question at a time, and only if necessary.
- Do NOT make assumptions.
- Do NOT hallucinate or invent information.

────────────────────────────────
KNOWLEDGE DEPENDENCY RULE
────────────────────────────────
All factual information MUST come ONLY from UPLOADED KNOWLEDGE.

1. If UPLOADED KNOWLEDGE contains relevant information:
   - Answer clearly using ONLY that information.

2. If UPLOADED KNOWLEDGE is EMPTY, INACTIVE, DELETED, or has NO relevant data:
   - You MUST end your response with: [MISSING_KNOWLEDGE: brief reason]
   - Politely inform the user you don't have that information.
   - Do NOT guess.

────────────────────────────────
RELEVANCE CHECK
────────────────────────────────
If "UPLOADED KNOWLEDGE" contains a "[Previous Question]" and "[Admin Resolution]":
- Verify if the previous question is on the SAME TOPIC as the current question.
- If different topics, IGNORE the resolution.

${hospitalPrompt}

CURRENT DATE & DAY & TIME (IST):
Date: ${currentDateFormatted}
Day: ${currentDayFormatted}
Time: ${currentTimeFormatted}

UPLOADED KNOWLEDGE:
${combinedKnowledge}
`;

    // Build message array for OpenAI
    const messages = [{ role: "system", content: systemPrompt }];

    // Add conversation history
    if (conversationHistory && conversationHistory.length > 0) {
      conversationHistory.forEach((msg) => {
        messages.push({
          role: msg.sender === "user" ? "user" : "assistant",
          content: msg.message,
        });
      });
    }

    // Add current user message
    messages.push({ role: "user", content: message });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.1,
      top_p: 0.9,
      max_tokens: 500,
      messages,
    });

    const rawReply = response?.choices?.[0]?.message?.content?.trim();
    const tokenUsage = response?.usage || {};

    console.log("[PLAYGROUND-AI-RAW]", rawReply);

    // Process tags
    const processed = await processResponse(rawReply, {
      tenant_id,
      userMessage: message,
    });

    const finalReply = processed.message;

    // Classify response (but don't persist logs for playground)
    let classification = null;
    try {
      classification = await classifyResponse(message, finalReply);
    } catch (err) {
      console.error("[PLAYGROUND-CLASSIFIER] Error:", err.message);
    }

    return {
      reply: finalReply,
      knowledgeSources: sources,
      knowledgeChunksUsed: chunks || [],
      resolvedLogsUsed: resolvedContext || "",
      responseOrigin:
        chunks && chunks.length > 0 ? "knowledge_base" : "ai_generated",
      tokenUsage: {
        prompt_tokens: tokenUsage.prompt_tokens || 0,
        completion_tokens: tokenUsage.completion_tokens || 0,
        total_tokens: tokenUsage.total_tokens || 0,
      },
      classification: classification
        ? {
            category: classification.category,
            reason: classification.reason,
          }
        : null,
    };
  } catch (err) {
    console.error("[PLAYGROUND] Error:", err.message);
    throw err;
  }
};
