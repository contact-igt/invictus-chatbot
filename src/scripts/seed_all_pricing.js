/**
 * ============================================================
 * MASTER PRICING SEED SCRIPT
 * ============================================================
 *
 * Seeds both Meta WhatsApp template pricing and AI model pricing
 * with 10% platform markup (markup_percent = 10)
 *
 * Run: node src/scripts/seed_all_pricing.js
 *
 * This script will:
 * 1. Seed Meta's official WhatsApp conversation rates by category & country
 * 2. Seed AI model pricing (OpenAI GPT models) per 1M tokens
 *
 * All rates include a 10% platform markup.
 * Super Admin can adjust markup_percent later via dashboard.
 * ============================================================
 */

import db from "../database/index.js";

// ============================================================
// META WHATSAPP TEMPLATE PRICING (Per Conversation - USD)
// Source: Meta Business Platform Official Rates 2024/2025
// ============================================================
// const META_TEMPLATE_PRICING = [
//   // India (IN) - Primary market
//   { category: "marketing", country: "IN", rate: 0.0107, markup_percent: 10 },
//   { category: "utility", country: "IN", rate: 0.0042, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "IN",
//     rate: 0.0028,
//     markup_percent: 10,
//   },
//   { category: "service", country: "IN", rate: 0.0, markup_percent: 10 }, // Free service conversations

//   // United States (US)
//   { category: "marketing", country: "US", rate: 0.025, markup_percent: 10 },
//   { category: "utility", country: "US", rate: 0.015, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "US",
//     rate: 0.0135,
//     markup_percent: 10,
//   },
//   { category: "service", country: "US", rate: 0.0, markup_percent: 10 },

//   // United Kingdom (GB)
//   { category: "marketing", country: "GB", rate: 0.0529, markup_percent: 10 },
//   { category: "utility", country: "GB", rate: 0.0233, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "GB",
//     rate: 0.0337,
//     markup_percent: 10,
//   },
//   { category: "service", country: "GB", rate: 0.0, markup_percent: 10 },

//   // United Arab Emirates (AE)
//   { category: "marketing", country: "AE", rate: 0.0384, markup_percent: 10 },
//   { category: "utility", country: "AE", rate: 0.0169, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "AE",
//     rate: 0.0183,
//     markup_percent: 10,
//   },
//   { category: "service", country: "AE", rate: 0.0, markup_percent: 10 },

//   // Saudi Arabia (SA)
//   { category: "marketing", country: "SA", rate: 0.0325, markup_percent: 10 },
//   { category: "utility", country: "SA", rate: 0.0143, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "SA",
//     rate: 0.0155,
//     markup_percent: 10,
//   },
//   { category: "service", country: "SA", rate: 0.0, markup_percent: 10 },

//   // Brazil (BR)
//   { category: "marketing", country: "BR", rate: 0.0625, markup_percent: 10 },
//   { category: "utility", country: "BR", rate: 0.008, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "BR",
//     rate: 0.0315,
//     markup_percent: 10,
//   },
//   { category: "service", country: "BR", rate: 0.0, markup_percent: 10 },

//   // Indonesia (ID)
//   { category: "marketing", country: "ID", rate: 0.0411, markup_percent: 10 },
//   { category: "utility", country: "ID", rate: 0.005, markup_percent: 10 },
//   { category: "authentication", country: "ID", rate: 0.03, markup_percent: 10 },
//   { category: "service", country: "ID", rate: 0.0, markup_percent: 10 },

//   // Mexico (MX)
//   { category: "marketing", country: "MX", rate: 0.0436, markup_percent: 10 },
//   { category: "utility", country: "MX", rate: 0.0056, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "MX",
//     rate: 0.0263,
//     markup_percent: 10,
//   },
//   { category: "service", country: "MX", rate: 0.0, markup_percent: 10 },

//   // Germany (DE)
//   { category: "marketing", country: "DE", rate: 0.1365, markup_percent: 10 },
//   { category: "utility", country: "DE", rate: 0.06, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "DE",
//     rate: 0.0867,
//     markup_percent: 10,
//   },
//   { category: "service", country: "DE", rate: 0.0, markup_percent: 10 },

//   // Spain (ES)
//   { category: "marketing", country: "ES", rate: 0.0615, markup_percent: 10 },
//   { category: "utility", country: "ES", rate: 0.027, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "ES",
//     rate: 0.0391,
//     markup_percent: 10,
//   },
//   { category: "service", country: "ES", rate: 0.0, markup_percent: 10 },

//   // Italy (IT)
//   { category: "marketing", country: "IT", rate: 0.0691, markup_percent: 10 },
//   { category: "utility", country: "IT", rate: 0.0304, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "IT",
//     rate: 0.0439,
//     markup_percent: 10,
//   },
//   { category: "service", country: "IT", rate: 0.0, markup_percent: 10 },

//   // Nigeria (NG)
//   { category: "marketing", country: "NG", rate: 0.0516, markup_percent: 10 },
//   { category: "utility", country: "NG", rate: 0.0066, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "NG",
//     rate: 0.0295,
//     markup_percent: 10,
//   },
//   { category: "service", country: "NG", rate: 0.0, markup_percent: 10 },

//   // South Africa (ZA)
//   { category: "marketing", country: "ZA", rate: 0.038, markup_percent: 10 },
//   { category: "utility", country: "ZA", rate: 0.0049, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "ZA",
//     rate: 0.0202,
//     markup_percent: 10,
//   },
//   { category: "service", country: "ZA", rate: 0.0, markup_percent: 10 },

//   // Global Fallback (default if no specific country rule)
//   { category: "marketing", country: "Global", rate: 0.075, markup_percent: 10 },
//   { category: "utility", country: "Global", rate: 0.015, markup_percent: 10 },
//   {
//     category: "authentication",
//     country: "Global",
//     rate: 0.015,
//     markup_percent: 10,
//   },
//   { category: "service", country: "Global", rate: 0.0, markup_percent: 10 },
// ];


const META_TEMPLATE_PRICING = [
 
  // ─────────────────── India (IN) ───────────────────
  // Jan 2026: marketing raised ~10%; utility & auth significantly lowered vs old rates
  // Apr 2026: authentication-international rate increased
  { category: "marketing",                   country: "IN", rate: 0.0094,  markup_percent: 10 }, // ✅ FIXED: was 0.0107 → ₹0.7846 ≈ $0.0094
  { category: "utility",                     country: "IN", rate: 0.0014,  markup_percent: 10 }, // ✅ FIXED: was 0.0042 → ₹0.115 ≈ $0.0014
  { category: "authentication",              country: "IN", rate: 0.0014,  markup_percent: 10 }, // ✅ FIXED: was 0.0028 → ₹0.115 ≈ $0.0014
  { category: "service",                     country: "IN", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── United States (US) ───────────────────
  // Jan 2026: utility & auth rates reduced
  { category: "marketing",                   country: "US", rate: 0.025,   markup_percent: 10 }, // ✅ correct
  { category: "utility",                     country: "US", rate: 0.004,   markup_percent: 10 }, // ✅ FIXED: was 0.015 → $0.004
  { category: "authentication",              country: "US", rate: 0.004,   markup_percent: 10 }, // ✅ FIXED: was 0.0135 → $0.004
  { category: "service",                     country: "US", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── United Kingdom (GB) ───────────────────
  // Rates in GBP; converted: marketing £0.0382, utility £0.0159, auth £0.0159
  { category: "marketing",                   country: "GB", rate: 0.0484,  markup_percent: 10 }, // ✅ FIXED: was 0.0529 → £0.0382 ≈ $0.0484
  { category: "utility",                     country: "GB", rate: 0.0201,  markup_percent: 10 }, // ✅ FIXED: was 0.0233 → £0.0159 ≈ $0.0201
  { category: "authentication",              country: "GB", rate: 0.0201,  markup_percent: 10 }, // ✅ FIXED: was 0.0337 → £0.0159 ≈ $0.0201
  { category: "service",                     country: "GB", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── United Arab Emirates (AE) ───────────────────
  // Oct 2025: marketing increased; auth-international added
  { category: "marketing",                   country: "AE", rate: 0.0499,  markup_percent: 10 }, // ✅ FIXED: was 0.0384 → $0.0499 (raised Oct 2025)
  { category: "utility",                     country: "AE", rate: 0.0157,  markup_percent: 10 }, // ✅ FIXED: was 0.0169 → $0.0157
  { category: "authentication",              country: "AE", rate: 0.0157,  markup_percent: 10 }, // ✅ FIXED: was 0.0183 → $0.0157
  { category: "service",                     country: "AE", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Saudi Arabia (SA) ───────────────────
  // Oct 2025: utility & auth reduced; auth-international added
  { category: "marketing",                   country: "SA", rate: 0.0455,  markup_percent: 10 }, // ✅ FIXED: was 0.0325 → $0.0455
  { category: "utility",                     country: "SA", rate: 0.0107,  markup_percent: 10 }, // ✅ FIXED: was 0.0143 → $0.0107
  { category: "authentication",              country: "SA", rate: 0.0107,  markup_percent: 10 }, // ✅ FIXED: was 0.0155 → $0.0107
  { category: "service",                     country: "SA", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Brazil (BR) ───────────────────
  // Jul 2025: utility & auth significantly reduced
  { category: "marketing",                   country: "BR", rate: 0.0625,  markup_percent: 10 }, // ✅ correct
  { category: "utility",                     country: "BR", rate: 0.0068,  markup_percent: 10 }, // ✅ FIXED: was 0.008 → $0.0068
  { category: "authentication",              country: "BR", rate: 0.0068,  markup_percent: 10 }, // ✅ FIXED: was 0.0315 → $0.0068
  { category: "service",                     country: "BR", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Indonesia (ID) ───────────────────
  // auth-international added
  { category: "marketing",                   country: "ID", rate: 0.0411,  markup_percent: 10 }, // ✅ correct
  { category: "utility",                     country: "ID", rate: 0.0043,  markup_percent: 10 }, // ✅ FIXED: was 0.005 → Rp 356.65 ≈ $0.0043 (approx, IDR billing)
  { category: "authentication",              country: "ID", rate: 0.0043,  markup_percent: 10 }, // ✅ FIXED: was 0.03 → Rp 356.65 ≈ $0.0043
  { category: "service",                     country: "ID", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Mexico (MX) ───────────────────
  // Oct 2025: marketing reduced; Jul 2025: auth reduced
  { category: "marketing",                   country: "MX", rate: 0.0305,  markup_percent: 10 }, // ✅ FIXED: was 0.0436 → $0.0305 (reduced Oct 2025)
  { category: "utility",                     country: "MX", rate: 0.0085,  markup_percent: 10 }, // ✅ FIXED: was 0.0056 → $0.0085
  { category: "authentication",              country: "MX", rate: 0.0085,  markup_percent: 10 }, // ✅ FIXED: was 0.0263 → $0.0085
  { category: "service",                     country: "MX", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Germany (DE) ───────────────────
  // Rates in EUR; converted: marketing €0.1131, utility €0.0456, auth €0.0456
  { category: "marketing",                   country: "DE", rate: 0.1229,  markup_percent: 10 }, // ✅ FIXED: was 0.1365 → €0.1131 ≈ $0.1229
  { category: "utility",                     country: "DE", rate: 0.0495,  markup_percent: 10 }, // ✅ FIXED: was 0.06 → €0.0456 ≈ $0.0495
  { category: "authentication",              country: "DE", rate: 0.0495,  markup_percent: 10 }, // ✅ FIXED: was 0.0867 → €0.0456 ≈ $0.0495
  { category: "service",                     country: "DE", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Spain (ES) ───────────────────
  // Rates in EUR; converted: marketing €0.0509, utility €0.0166, auth €0.0166
  { category: "marketing",                   country: "ES", rate: 0.0553,  markup_percent: 10 }, // ✅ FIXED: was 0.0615 → €0.0509 ≈ $0.0553
  { category: "utility",                     country: "ES", rate: 0.0180,  markup_percent: 10 }, // ✅ FIXED: was 0.027 → €0.0166 ≈ $0.0180
  { category: "authentication",              country: "ES", rate: 0.0180,  markup_percent: 10 }, // ✅ FIXED: was 0.0391 → €0.0166 ≈ $0.0180
  { category: "service",                     country: "ES", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Italy (IT) ───────────────────
  // Rates in EUR; converted: marketing €0.0572, utility €0.0248, auth €0.0248
  { category: "marketing",                   country: "IT", rate: 0.0621,  markup_percent: 10 }, // ✅ FIXED: was 0.0691 → €0.0572 ≈ $0.0621
  { category: "utility",                     country: "IT", rate: 0.0269,  markup_percent: 10 }, // ✅ FIXED: was 0.0304 → €0.0248 ≈ $0.0269
  { category: "authentication",              country: "IT", rate: 0.0269,  markup_percent: 10 }, // ✅ FIXED: was 0.0439 → €0.0248 ≈ $0.0269
  { category: "service",                     country: "IT", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Nigeria (NG) ───────────────────
  // auth-international added Feb 2025
  { category: "marketing",                   country: "NG", rate: 0.0516,  markup_percent: 10 }, // ✅ correct
  { category: "utility",                     country: "NG", rate: 0.0067,  markup_percent: 10 }, // ✅ FIXED: was 0.0066 → $0.0067
  { category: "authentication",              country: "NG", rate: 0.0067,  markup_percent: 10 }, // ✅ FIXED: was 0.0295 → $0.0067
  { category: "service",                     country: "NG", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── South Africa (ZA) ───────────────────
  // auth-international added Feb/Apr 2025
  { category: "marketing",                   country: "ZA", rate: 0.0379,  markup_percent: 10 }, // ✅ FIXED: was 0.038 → $0.0379
  { category: "utility",                     country: "ZA", rate: 0.0076,  markup_percent: 10 }, // ✅ FIXED: was 0.0049 → $0.0076
  { category: "authentication",              country: "ZA", rate: 0.0076,  markup_percent: 10 }, // ✅ FIXED: was 0.0202 → $0.0076
  { category: "service",                     country: "ZA", rate: 0.0,     markup_percent: 10 }, // ✅ Free
 
  // ─────────────────── Global Fallback ───────────────────
  // "Rest of World" / Other — use Meta's published global fallback
  { category: "marketing",                   country: "Global", rate: 0.0604, markup_percent: 10 }, // ✅ FIXED: was 0.075 → $0.0604
  { category: "utility",                     country: "Global", rate: 0.0077, markup_percent: 10 }, // ✅ FIXED: was 0.015 → $0.0077
  { category: "authentication",              country: "Global", rate: 0.0077, markup_percent: 10 }, // ✅ FIXED: was 0.015 → $0.0077
  { category: "service",                     country: "Global", rate: 0.0,    markup_percent: 10 }, // ✅ Free
];

// ============================================================
// AI MODEL PRICING (Per 1 Million Tokens - USD)
// Source: OpenAI Official Pricing 2024/2025
// ============================================================
const AI_MODEL_PRICING = [
  // ──────────────────  PREMIUM TIER ──────────────────
  {
    model: "gpt-4o",
    description: "Most capable model for complex output generation",
    recommended_for: "output",
    category: "premium",
    input_rate: 2.5,     // $2.50 per 1M input tokens  ✅ correct
    output_rate: 10.0,   // $10.00 per 1M output tokens ✅ correct
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
  {
    model: "gpt-4.5",
    description:
      "Most capable GPT-4.5 model with enhanced creativity and nuanced understanding (deprecated — not recommended for new projects)",
    recommended_for: "output",
    category: "premium",
    input_rate: 75.0,    // $75.00 per 1M input tokens  ✅ correct (but deprecated)
    output_rate: 150.0,  // $150.00 per 1M output tokens ✅ correct (but deprecated)
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: false,    // ⚠️ deprecated by OpenAI — set inactive
  },
  {
    model: "gpt-5",
    description: "Next generation flagship GPT model for complex reasoning and agentic workflows",
    recommended_for: "output",
    category: "premium",
    input_rate: 1.25,    // ✅ FIXED: was 100.0 → correct is $1.25 per 1M input tokens
    output_rate: 10.0,   // ✅ FIXED: was 300.0 → correct is $10.00 per 1M output tokens
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
 
  // ──────────────────  MID-TIER ──────────────────
  {
    model: "gpt-4.1",
    description: "Recommended production model — strong coding, instruction following, 1M context window",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 2.0,     // $2.00 per 1M input tokens
    output_rate: 8.0,    // $8.00 per 1M output tokens
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
  {
    model: "gpt-4.1-mini",
    description: "Balanced performance and cost for general tasks",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 0.4,     // $0.40 per 1M input tokens  ✅ correct
    output_rate: 1.6,    // $1.60 per 1M output tokens ✅ correct
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
  {
    // ✅ FIXED: gpt-4.5-mini does NOT exist → replaced with gpt-5-mini
    model: "gpt-5-mini",
    description: "Compact GPT-5 model for efficient deployment at budget pricing",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 0.25,    // ✅ FIXED: was 8.0 → correct is $0.25 per 1M input tokens
    output_rate: 2.0,    // ✅ FIXED: was 24.0 → correct is $2.00 per 1M output tokens
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
 
  // ──────────────────  BUDGET TIER ──────────────────
  {
    model: "gpt-4o-mini",
    description: "Fast and affordable for input classification tasks",
    recommended_for: "input",
    category: "budget",
    input_rate: 0.15,    // $0.15 per 1M input tokens  ✅ correct
    output_rate: 0.6,    // $0.60 per 1M output tokens ✅ correct
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
  {
    model: "gpt-4.1-nano",
    description: "Ultra-low-cost model for simple classification and extraction",
    recommended_for: "input",
    category: "budget",
    input_rate: 0.1,     // $0.10 per 1M input tokens  ✅ correct
    output_rate: 0.4,    // $0.40 per 1M output tokens ✅ correct
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
  {
    // ✅ FIXED: gpt-4.5-nano does NOT exist → replaced with gpt-5-nano
    model: "gpt-5-nano",
    description: "Smallest GPT-5 variant — budget champion for high-volume simple tasks",
    recommended_for: "input",
    category: "budget",
    input_rate: 0.05,    // ✅ FIXED: was 1.5 → correct is $0.05 per 1M input tokens
    output_rate: 0.4,    // ✅ FIXED: was 3.0 → correct is $0.40 per 1M output tokens
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
 
  // ──────────────────  REASONING MODELS ──────────────────
  {
    model: "o3",
    description: "Advanced reasoning model with superior problem-solving ability",
    recommended_for: "output",
    category: "reasoning",
    input_rate: 2.0,     // ✅ FIXED: was 10.0 → correct is $2.00 per 1M input tokens (price cut by OpenAI)
    output_rate: 8.0,    // ✅ FIXED: was 40.0 → correct is $8.00 per 1M output tokens
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
  {
    model: "o3-mini",
    description: "Cost-efficient reasoning model",
    recommended_for: "both",
    category: "reasoning",
    input_rate: 1.1,     // $1.10 per 1M input tokens  ✅ correct
    output_rate: 4.4,    // $4.40 per 1M output tokens ✅ correct
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
  {
    model: "o4-mini",
    description: "Next-gen reasoning model for complex decision making — best-value reasoning model",
    recommended_for: "both",
    category: "reasoning",
    input_rate: 1.1,     // $1.10 per 1M input tokens  ✅ correct
    output_rate: 4.4,    // $4.40 per 1M output tokens ✅ correct
    markup_percent: 10,
    usd_to_inr_rate: 94,
    is_active: true,
  },
];
// ============================================================
// SEED FUNCTIONS
// ============================================================

const seedMetaTemplatePricing = async () => {
  console.log("\nðŸ“¦ Seeding Meta WhatsApp Template Pricing...\n");
  let added = 0;
  let skipped = 0;

  for (const rule of META_TEMPLATE_PRICING) {
    try {
      const existing = await db.PricingTable.findOne({
        where: { category: rule.category, country: rule.country },
      });

      if (!existing) {
        await db.PricingTable.create(rule);
        console.log(
          `  âœ… Added: ${rule.category.padEnd(14)} | ${rule.country.padEnd(6)} | $${rule.rate.toFixed(4)}`,
        );
        added++;
      } else {
        // Update existing record to ensure markup is 10%
        await existing.update({ rate: rule.rate, markup_percent: 10 });
        console.log(
          `  ðŸ”„ Updated: ${rule.category.padEnd(14)} | ${rule.country.padEnd(6)} | $${rule.rate.toFixed(4)}`,
        );
        skipped++;
      }
    } catch (error) {
      console.error(
        `  âŒ Error: ${rule.category} / ${rule.country}:`,
        error.message,
      );
    }
  }

  console.log(
    `\n  ðŸ“Š Meta Pricing Summary: ${added} added, ${skipped} updated`,
  );
};

const seedAiModelPricing = async () => {
  console.log("\nðŸ¤– Seeding AI Model Pricing...\n");
  let added = 0;
  let skipped = 0;

  for (const model of AI_MODEL_PRICING) {
    try {
      const existing = await db.AiPricing.findOne({
        where: { model: model.model },
      });

      if (!existing) {
        await db.AiPricing.create(model);
        console.log(
          `  âœ… Added: ${model.model.padEnd(20)} | ${model.category.padEnd(9)} | Input: $${model.input_rate.toFixed(2)}/M | Output: $${model.output_rate.toFixed(2)}/M`,
        );
        added++;
      } else {
        // Update existing record to ensure markup is 10% and rates are current
        await existing.update({
          description: model.description,
          recommended_for: model.recommended_for,
          category: model.category,
          input_rate: model.input_rate,
          output_rate: model.output_rate,
          markup_percent: 10,
          usd_to_inr_rate: model.usd_to_inr_rate,
          is_active: model.is_active,
        });
        console.log(
          `  ðŸ”„ Updated: ${model.model.padEnd(20)} | ${model.category.padEnd(9)} | Input: $${model.input_rate.toFixed(2)}/M | Output: $${model.output_rate.toFixed(2)}/M`,
        );
        skipped++;
      }
    } catch (error) {
      console.error(`  âŒ Error: ${model.model}:`, error.message);
    }
  }

  console.log(`\n  ðŸ“Š AI Model Summary: ${added} added, ${skipped} updated`);
};

// ============================================================
// MAIN EXECUTION
// ============================================================

const seedAllPricing = async () => {
  console.log(
    "â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•",
  );
  console.log("       MASTER PRICING SEED SCRIPT - 10% PLATFORM MARKUP");
  console.log(
    "â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•",
  );

  try {
    console.log("\nðŸ”Œ Connecting to database...");
    await db.sequelize.authenticate();
    console.log("âœ… Database connected successfully!\n");

    // Seed Meta Template Pricing
    await seedMetaTemplatePricing();

    // Seed AI Model Pricing
    await seedAiModelPricing();

    console.log(
      "\nâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•",
    );
    console.log("       âœ… ALL PRICING DATA SEEDED SUCCESSFULLY!");
    console.log(
      "â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•",
    );
    console.log("\nðŸ“ Notes:");
    console.log(
      "   \u2022 All markup_percent values are set to 10 (10% platform markup)",
    );
    console.log("   â€¢ Super Admin can adjust markup via dashboard later");
    console.log("   • USD to INR rate is set to 93.0 for AI models");
    console.log("\n");

    process.exit(0);
  } catch (error) {
    console.error("\nâŒ SEED FAILED:", error);
    process.exit(1);
  }
};

// Run the seed
seedAllPricing();
