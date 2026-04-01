import db from "../../database/index.js";
import { getIO } from "../../middlewares/socket/socket.js";

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

// Default USD to INR rate
const DEFAULT_USD_TO_INR = 85;
// Default platform markup when pricing is not in DB
const DEFAULT_MARKUP_PERCENT = 10;

/**
 * Normalize OpenAI versioned model names to base pricing keys.
 * OpenAI often returns "gpt-4o-2024-08-06" but pricing is stored under "gpt-4o".
 * Strategy: try exact match first, then find the known base key whose name the
 * versioned string starts with (longest match wins to avoid e.g. "gpt-4o" beating "gpt-4o-mini").
 *
 * @param {string} rawModel  - e.g. "gpt-4o-2024-08-06"
 * @param {string[]} knownKeys - known pricing keys to match against
 * @returns {string} - normalized base model name
 */
const normalizeModelName = (rawModel, knownKeys) => {
  if (!rawModel) return "gpt-4o-mini";
  if (knownKeys.includes(rawModel)) return rawModel;
  // Sort longest first so "gpt-4o-mini" matches before "gpt-4o"
  const sorted = [...knownKeys].sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (rawModel.startsWith(key)) return key;
  }
  return rawModel;
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
 * Logs AI token usage from an OpenAI API response and deducts from wallet.
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
    const rawModel = response.model || "gpt-4o-mini";

    // Try DB pricing first, fallback to hardcoded
    const dbPricing = await getAiPricing();
    let estimatedCostUsd;
    let usdToInr = DEFAULT_USD_TO_INR;
    let appliedMarkup = DEFAULT_MARKUP_PERCENT;
    let pricingSnapshot = {};

    // Normalize versioned model name (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
    const dbKeys = dbPricing ? Object.keys(dbPricing) : [];
    const fallbackKeys = Object.keys(FALLBACK_PRICING);
    const allKnownKeys = [...new Set([...dbKeys, ...fallbackKeys])];
    const model = normalizeModelName(rawModel, allKnownKeys);

    if (dbPricing && dbPricing[model]) {
      const p = dbPricing[model];
      const baseCost =
        (prompt_tokens / 1_000_000) * p.input +
        (completion_tokens / 1_000_000) * p.output;
      appliedMarkup = p.markup;
      estimatedCostUsd = baseCost * (1 + p.markup / 100);
      usdToInr = p.usdToInr || DEFAULT_USD_TO_INR;

      // Store full pricing snapshot for audit trail
      pricingSnapshot = {
        input_rate: p.input,
        output_rate: p.output,
        markup_percent: p.markup,
        usd_to_inr_rate: usdToInr,
        base_cost_usd: baseCost,
      };
    } else {
      // Fallback pricing — apply default markup so cost is consistent with DB path
      const pricing = FALLBACK_PRICING[model] || FALLBACK_PRICING["gpt-4o-mini"];
      const baseCost =
        (prompt_tokens / 1_000_000) * pricing.input +
        (completion_tokens / 1_000_000) * pricing.output;
      estimatedCostUsd = baseCost * (1 + DEFAULT_MARKUP_PERCENT / 100);

      pricingSnapshot = {
        input_rate: pricing.input,
        output_rate: pricing.output,
        markup_percent: DEFAULT_MARKUP_PERCENT,
        usd_to_inr_rate: usdToInr,
        base_cost_usd: baseCost,
      };
    }

    // Round only at storage boundary — never round intermediate values
    const finalCostUsd   = Number(estimatedCostUsd.toFixed(8));
    const finalCostInr   = Number((estimatedCostUsd * usdToInr).toFixed(6));
    const baseCostUsdRnd = Number(pricingSnapshot.base_cost_usd.toFixed(8));

    console.log(
      `[AI-TOKEN-TRACKER] model=${rawModel} → normalized=${model} | ` +
      `input=${prompt_tokens} output=${completion_tokens} | ` +
      `input_rate=${pricingSnapshot.input_rate} output_rate=${pricingSnapshot.output_rate} | ` +
      `base_usd=${baseCostUsdRnd} markup=${appliedMarkup}% final_usd=${finalCostUsd} | ` +
      `usd_to_inr=${usdToInr} final_inr=${finalCostInr}`
    );

    // Convert USD to INR for wallet deduction
    const estimatedCostInr = finalCostInr;

    // Use transaction for atomic operations
    await db.sequelize.transaction(async (t) => {
      // 1. Create AI token usage record — store normalized model name and full cost breakdown
      const usageRecord = await db.AiTokenUsage.create(
        {
          tenant_id,
          model,                  // normalized (e.g. "gpt-4o", not "gpt-4o-2024-08-06")
          source,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          estimated_cost: finalCostUsd,          // USD after markup (backward compat)
          input_rate:     pricingSnapshot.input_rate,
          output_rate:    pricingSnapshot.output_rate,
          markup_percent: pricingSnapshot.markup_percent,
          usd_to_inr_rate: pricingSnapshot.usd_to_inr_rate,
          base_cost_usd:  baseCostUsdRnd,        // USD before markup
          final_cost_usd: finalCostUsd,          // USD after markup
          final_cost_inr: finalCostInr,          // INR — authoritative display value
        },
        { transaction: t },
      );

      // 2. Deduct from wallet if cost > 0
      if (estimatedCostInr > 0) {
        // Find or create wallet
        let [wallet] = await db.Wallets.findOrCreate({
          where: { tenant_id },
          defaults: { tenant_id, balance: 0, currency: "INR" },
          transaction: t,
        });

        // Deduct balance - prevent going below -10 (small grace period)
        const oldBalance = parseFloat(wallet.balance);
        const minBalance = -10; // Small grace to avoid hard cutoff during active conversations

        // If already at minimum, skip deduction but still log usage
        if (oldBalance <= minBalance) {
          console.warn(
            `[AI-TOKEN-TRACKER] Tenant ${tenant_id} at minimum balance (₹${oldBalance.toFixed(2)}). Skipping deduction.`,
          );
          // Still emit warning to frontend
          try {
            const io = getIO();
            io.to(`tenant-${tenant_id}`).emit("low-balance-warning", {
              balance: oldBalance,
              critical: true,
              message:
                "Wallet balance depleted. Please recharge immediately to continue AI services.",
            });
          } catch (_) {}
          return; // Exit early - usage is tracked but not billed
        }

        // Calculate new balance but cap at minimum
        let newBalance = oldBalance - estimatedCostInr;
        if (newBalance < minBalance) {
          newBalance = minBalance;
        }

        await wallet.update({ balance: newBalance }, { transaction: t });

        // 3. Record the wallet transaction
        await db.WalletTransactions.create(
          {
            tenant_id,
            type: "debit",
            amount: estimatedCostInr,
            reference_id: `ai_usage_${usageRecord.id}`,
            description: `AI Usage: ${model} (${source}) - ${total_tokens} tokens`,
            balance_after: newBalance,
          },
          { transaction: t },
        );

        // 4. Emit real-time update via Socket
        try {
          const io = getIO();
          const payload = {
            type: "AI_TOKEN_USAGE",
            tenant_id,
            model,
            source,
            totalTokens: total_tokens,
            costInr: estimatedCostInr,
            currentBalance: newBalance,
            lowBalance: newBalance < 100,
            timestamp: new Date(),
          };
          io.to(`tenant-${tenant_id}`).emit("billing-update", payload);

          // Emit low balance warning if needed
          if (newBalance < 100) {
            io.to(`tenant-${tenant_id}`).emit("low-balance-warning", {
              balance: newBalance,
              message:
                newBalance <= 0
                  ? "Wallet balance is zero or negative. Recharge immediately to continue AI services."
                  : `Wallet balance is low (₹${newBalance.toFixed(2)}). Please recharge soon.`,
            });
          }
        } catch (socketErr) {
          console.error(
            "[AI-TOKEN-TRACKER] Socket emit error:",
            socketErr.message,
          );
        }

        console.log(
          `[AI-TOKEN-TRACKER] Billed ${model} for tenant ${tenant_id}: ₹${estimatedCostInr.toFixed(6)} (${total_tokens} tokens). Balance: ₹${newBalance.toFixed(4)}`,
        );
      }
    });
  } catch (err) {
    console.error("[AI-TOKEN-TRACKER] Failed to log token usage:", err.message);
  }
};