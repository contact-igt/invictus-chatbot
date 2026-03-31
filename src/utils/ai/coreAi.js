import { trackAiTokenUsage } from "./trackAiTokenUsage.js";
import { getTenantAiModel } from "./getTenantAiModel.js";
import { getOpenAIClient } from "./getOpenAIClient.js";

/**
 * Token limits by source — prevents runaway token usage.
 */
const TOKEN_LIMITS = {
  language_detect: 80,
  classifier: 80,
  knowledge_search: 50,
  lead_summary: 300,
  smart_reply: 500,
  utility: 150,
  frontend_utility: 500,
  knowledge_process: 3000,
  playground: 1200,
  whatsapp: 1200,
  whatsapp_retry: 1600,
};

/**
 * Sources that should use the lighter/cheaper input model.
 */
const INPUT_MODEL_SOURCES = [
  "language_detect",
  "classifier",
  "knowledge_search",
  "knowledge_process",
];

/**
 * Centralized AI service — single entry point for ALL OpenAI calls in the project.
 *
 * @param {object} options
 * @param {Array<{role: string, content: string}>} options.messages - OpenAI messages array
 * @param {string} [options.tenant_id] - Tenant ID for model/key resolution and billing
 * @param {string} [options.source="utility"] - Call origin for billing and token limits
 * @param {number} [options.temperature=0.01] - Sampling temperature
 * @param {number} [options.maxTokens] - Override max_tokens (auto-resolved from source if omitted)
 * @param {object} [options.responseFormat] - e.g. { type: "json_object" }
 * @param {number} [options.topP] - top_p sampling parameter
 * @returns {Promise<{content: string, usage: object, raw: object}>}
 */
export const callAI = async ({
  messages,
  tenant_id = null,
  source = "utility",
  temperature = 0.01,
  maxTokens,
  responseFormat,
  topP,
}) => {
  const modelType = INPUT_MODEL_SOURCES.includes(source) ? "input" : "output";
  const model = await getTenantAiModel(tenant_id, modelType);
  const openai = await getOpenAIClient(tenant_id);

  const params = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens || TOKEN_LIMITS[source] || 150,
  };
  if (responseFormat) params.response_format = responseFormat;
  if (topP !== undefined) params.top_p = topP;

  const response = await openai.chat.completions.create(params);

  // Track token usage (non-blocking)
  if (tenant_id) {
    trackAiTokenUsage(tenant_id, source, response).catch((e) =>
      console.error(`[AI-SERVICE:${source}] Token tracking failed:`, e.message),
    );
  }

  return {
    content: response.choices[0].message.content.trim(),
    finishReason: response.choices[0].finish_reason,
    usage: response.usage || {},
    raw: response,
  };
};

/**
 * Legacy wrapper — keeps backward compatibility with existing callers.
 * Prefer callAI() for new code.
 */
export const AiService = async (
  system,
  prompt,
  tenant_id = null,
  source = "utility",
) => {
  try {
    const result = await callAI({
      messages: [{ role: system, content: prompt }],
      tenant_id,
      source,
    });
    return result.content;
  } catch (err) {
    console.error("OpenAI error:", err.message);
    throw new Error(`AI generation failed: ${err.message}`);
  }
};
