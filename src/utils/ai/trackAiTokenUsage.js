import db from "../../database/index.js";

// Fallback pricing per 1M tokens (used only if no DB pricing configured)
const FALLBACK_PRICING = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.5": { input: 75.0, output: 150.0 },
  "gpt-4.5-mini": { input: 7.5, output: 15.0 },
  "gpt-4.5-nano": { input: 1.5, output: 3.0 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "o3-mini": { input: 1.1, output: 4.4 },
  o1: { input: 15.0, output: 60.0 },
  "o1-mini": { input: 3.0, output: 12.0 },
  o3: { input: 10.0, output: 40.0 },
  "o3-pro": { input: 20.0, output: 80.0 },
  "gpt-4o-audio-preview": { input: 2.5, output: 10.0 },
  "gpt-5": { input: 100.0, output: 300.0 },
  "gpt-5-mini": { input: 8.0, output: 24.0 },
};

// In-memory cache for AI pricing (refreshed every 5 minutes)
let pricingCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getAiPricing = async () => {
  const now = Date.now();
  if (pricingCache && now - cacheTimestamp < CACHE_TTL) {
    return pricingCache;
  }

  try {
    const rules = await db.AiPricing.findAll({
      where: { is_active: true },
      raw: true,
    });

    if (rules && rules.length > 0) {
      const pricing = {};
      for (const rule of rules) {
        pricing[rule.model] = {
          input: parseFloat(rule.input_rate),
          output: parseFloat(rule.output_rate),
          markup: parseFloat(rule.markup_percent || 0),
          usdToInr: parseFloat(rule.usd_to_inr_rate || 85),
        };
      }
      pricingCache = pricing;
      cacheTimestamp = now;
      return pricing;
    }
  } catch (err) {
    console.error(
      "[AI-TOKEN-TRACKER] Failed to fetch pricing from DB:",
      err.message,
    );
  }

  // If DB has no rules, use fallback
  return null;
};

/**
 * Logs AI token usage from an OpenAI API response.
 * Call this after every openai.chat.completions.create() call.
 *
 * @param {string} tenant_id - Tenant identifier
 * @param {string} source - Origin of the call (whatsapp, playground, classifier, knowledge, language_detect)
 * @param {object} response - The full OpenAI response object (with usage property)
 */
export const trackAiTokenUsage = async (tenant_id, source, response) => {
  try {
    if (!response?.usage) return;

    const {
      prompt_tokens = 0,
      completion_tokens = 0,
      total_tokens = 0,
    } = response.usage;
    const model = response.model || "gpt-4o-mini";

    // Try DB pricing first, fallback to hardcoded
    const dbPricing = await getAiPricing();
    let estimatedCost;

    if (dbPricing && dbPricing[model]) {
      const p = dbPricing[model];
      const baseCost =
        (prompt_tokens / 1_000_000) * p.input +
        (completion_tokens / 1_000_000) * p.output;
      estimatedCost = baseCost * (1 + p.markup / 100);
    } else {
      const pricing =
        FALLBACK_PRICING[model] || FALLBACK_PRICING["gpt-4o-mini"];
      estimatedCost =
        (prompt_tokens / 1_000_000) * pricing.input +
        (completion_tokens / 1_000_000) * pricing.output;
    }

    await db.AiTokenUsage.create({
      tenant_id,
      model,
      source,
      prompt_tokens,
      completion_tokens,
      total_tokens,
      estimated_cost: estimatedCost,
    });
  } catch (err) {
    console.error("[AI-TOKEN-TRACKER] Failed to log token usage:", err.message);
  }
};
