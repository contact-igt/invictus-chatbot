import { getOpenAIClient } from "./getOpenAIClient.js";

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

const sanitizeInput = (text = "") =>
  String(text)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);

export const generateTextEmbedding = async (text, tenant_id = null) => {
  const input = sanitizeInput(text);
  if (!input) {
    throw new Error("[EMBEDDING] Empty input after sanitization — cannot generate embedding");
  }

  const openai = await getOpenAIClient(tenant_id);
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });

  const embedding = response?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error(`[EMBEDDING] API returned empty/invalid embedding vector for input: "${input.substring(0, 60)}"`);
  }

  