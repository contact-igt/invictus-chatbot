import { getOpenAIClient } from "./getOpenAIClient.js";

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

const sanitizeInput = (text = "") =>
  String(text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);

export const generateTextEmbedding = async (text, tenant_id = null) => {
  const input = sanitizeInput(text);
  if (!input) return null;

  try {
    const openai = await getOpenAIClient(tenant_id);
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input,
    });

    const embedding = response?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) return null;
    return embedding;
  } catch (err) {
    console.error("[EMBEDDING] Failed to generate embedding:", err.message);
    return null;
  }
};

export const parseEmbedding = (rawEmbedding) => {
  if (!rawEmbedding) return null;

  let values = rawEmbedding;
  if (typeof rawEmbedding === "string") {
    try {
      values = JSON.parse(rawEmbedding);
    } catch (err) {
      return null;
    }
  }

  if (!Array.isArray(values) || values.length === 0) return null;

  const parsed = values.map((value) => Number(value));
  if (parsed.some((value) => Number.isNaN(value))) return null;

  return parsed;
};

export const cosineSimilarity = (vectorA, vectorB) => {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB)) return 0;
  if (!vectorA.length || !vectorB.length) return 0;
  if (vectorA.length !== vectorB.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vectorA.length; i += 1) {
    const a = Number(vectorA[i]);
    const b = Number(vectorB[i]);

    if (Number.isNaN(a) || Number.isNaN(b)) return 0;

    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
