import db from "../../database/index.js";
import { DEFAULT_MARKUP_PERCENT } from "../../config/billing.config.js";
import { getConversionRate } from "./currencyService.js";

// Hardcoded fallback rates per message (USD) — used when no DB pricing exists
const DEFAULT_META_RATES = {
  marketing: 0.075,
  utility: 0.015,
  authentication: 0.015,
  service: 0,
};

// Fallback AI pricing per 1M tokens (USD)
const FALLBACK_AI_PRICING = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-4.5": { input: 75.0, output: 150.0 },
  "o4-mini": { input: 1.1, output: 4.4 },
  "o3-mini": { input: 1.1, output: 4.4 },
  o1: { input: 15.0, output: 60.0 },
  "o1-mini": { input: 3.0, output: 12.0 },
  o3: { input: 2.0, output: 8.0 },
  "gpt-4o-audio-preview": { input: 2.5, output: 10.0 },
  "gpt-5.4": { input: 2.5, output: 15.0 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },
};

// In-memory cache for AI pricing rules (5-min TTL)
let aiPricingCache = null;
let aiCacheTimestamp = 0;
const AI_CACHE_TTL = 5 * 60 * 1000;

/**
 * Normalizes versioned model names to their base form.
 * e.g. "gpt-4o-2024-08-06" → "gpt-4o"
 */
const normalizeModelName = (rawModel, knownKeys) => {
  if (knownKeys.includes(rawModel)) return rawModel;
  const stripped = rawModel.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  if (knownKeys.includes(stripped)) return stripped;
  return stripped;
};

/**
 * Load AI pricing from DB with 5-min cache.
 */
const getAiPricingRules = async () => {
  const now = Date.now();
  if (aiPricingCache && now - aiCacheTimestamp < AI_CACHE_TTL) {
    return aiPricingCache;
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
          pricing_version: rule.pricing_version || 1,
        };
      }
      aiPricingCache = pricing;
      aiCacheTimestamp = now;
      return pricing;
    }
  } catch (err) {
    console.error(
      "[COST-ESTIMATOR] Failed to fetch AI pricing from DB:",
      err.message,
    );
  }

  return null;
};

/**
 * Estimate cost for a Meta WhatsApp message.
 *
 * @param {string} category  - e.g. "marketing", "utility", "authentication", "service"
 * @param {string} country   - ISO country code or "Global"
 * @returns {Promise<{ baseRate: number, markupPercent: number, platformFee: number, totalCostUsd: number, totalCostInr: number, conversionRate: number, pricingVersion: number|null }>}
 */
export const estimateMetaCost = async (category, country = "Global") => {
  let baseRate = 0;
  let markupPercent = DEFAULT_MARKUP_PERCENT;
  let pricingVersion = null;

  // 1. Try exact match
  let pricingRule = await db.PricingTable.findOne({
    where: { category, country },
    raw: true,
  });

  // 2. Try global fallback
  if (!pricingRule) {
    pricingRule = await db.PricingTable.findOne({
      where: { category, country: "Global" },
      raw: true,
    });
  }

  if (pricingRule) {
    baseRate = parseFloat(pricingRule.rate);
    markupPercent = parseFloat(pricingRule.markup_percent);
    pricingVersion = pricingRule.pricing_version || null;
  } else {
    // 3. Hardcoded fallback
    baseRate = DEFAULT_META_RATES[category] || 0;
  }

  const platformFee = baseRate * (markupPercent / 100);
  const totalCostUsd = baseRate + platformFee;

  // Convert USD → INR via centralized currency service
  const { rate: conversionRate } = await getConversionRate("USD", "INR");
  const totalCostInr = totalCostUsd * conversionRate;

  return {
    baseRate,
    markupPercent,
    platformFee,
    totalCostUsd,
    totalCostInr,
    conversionRate,
    pricingVersion,
  };
};

/**
 * Estimate cost for an AI API call.
 *
 * @param {string} rawModel         - Model name (possibly versioned)
 * @param {number} promptTokens     - Number of input tokens
 * @param {number} completionTokens - Number of output tokens
 * @returns {Promise<{ model: string, baseCostUsd: number, markupPercent: number, finalCostUsd: number, finalCostInr: number, conversionRate: number, pricingVersion: number|null, pricingSnapshot: object }>}
 */
export const estimateAiCost = async (
  rawModel,
  promptTokens = 0,
  completionTokens = 0,
) => {
  const dbPricing = await getAiPricingRules();

  const dbKeys = dbPricing ? Object.keys(dbPricing) : [];
  const fallbackKeys = Object.keys(FALLBACK_AI_PRICING);
  const allKnownKeys = [...new Set([...dbKeys, ...fallbackKeys])];
  const model = normalizeModelName(rawModel, allKnownKeys);

  let baseCostUsd;
  let appliedMarkup;
  let pricingVersion = null;
  let pricingSnapshot;

  if (dbPricing && dbPricing[model]) {
    const p = dbPricing[model];
    baseCostUsd =
      (promptTokens / 1_000_000) * p.input +
      (completionTokens / 1_000_000) * p.output;
    appliedMarkup = p.markup;
    pricingVersion = p.pricing_version;
    pricingSnapshot = {
      input_rate: p.input,
      output_rate: p.output,
      markup_percent: p.markup,
      base_cost_usd: baseCostUsd,
    };
  } else {
    const pricing =
      FALLBACK_AI_PRICING[model] || FALLBACK_AI_PRICING["gpt-4o-mini"];
    baseCostUsd =
      (promptTokens / 1_000_000) * pricing.input +
      (completionTokens / 1_000_000) * pricing.output;
    appliedMarkup = DEFAULT_MARKUP_PERCENT;
    pricingSnapshot = {
      input_rate: pricing.input,
      output_rate: pricing.output,
      markup_percent: DEFAULT_MARKUP_PERCENT,
      base_cost_usd: baseCostUsd,
    };
  }

  const finalCostUsd = baseCostUsd * (1 + appliedMarkup / 100);

  // Convert USD → INR via centralized currency service
  const { rate: conversionRate } = await getConversionRate("USD", "INR");
  const finalCostInr = finalCostUsd * conversionRate;

  return {
    model,
    baseCostUsd,
    markupPercent: appliedMarkup,
    finalCostUsd,
    finalCostInr,
    conversionRate,
    pricingVersion,
    pricingSnapshot,
  };
};

/**
 * Estimate total cost combining Meta + AI (convenience wrapper).
 */
export const estimateTotalCost = (metaCost, aiCost) => {
  return (metaCost?.totalCostInr || 0) + (aiCost?.finalCostInr || 0);
};

/**
 * Invalidate AI pricing cache (e.g. after admin pricing update).
 */
export const invalidateAiPricingCache = () => {
  aiPricingCache = null;
  aiCacheTimestamp = 0;
};
