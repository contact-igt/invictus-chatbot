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
const META_TEMPLATE_PRICING = [
  // India (IN) - Primary market
  { category: "marketing", country: "IN", rate: 0.0107, markup_percent: 10 },
  { category: "utility", country: "IN", rate: 0.0042, markup_percent: 10 },
  {
    category: "authentication",
    country: "IN",
    rate: 0.0028,
    markup_percent: 10,
  },
  { category: "service", country: "IN", rate: 0.0, markup_percent: 10 }, // Free service conversations

  // United States (US)
  { category: "marketing", country: "US", rate: 0.025, markup_percent: 10 },
  { category: "utility", country: "US", rate: 0.015, markup_percent: 10 },
  {
    category: "authentication",
    country: "US",
    rate: 0.0135,
    markup_percent: 10,
  },
  { category: "service", country: "US", rate: 0.0, markup_percent: 10 },

  // United Kingdom (GB)
  { category: "marketing", country: "GB", rate: 0.0529, markup_percent: 10 },
  { category: "utility", country: "GB", rate: 0.0233, markup_percent: 10 },
  {
    category: "authentication",
    country: "GB",
    rate: 0.0337,
    markup_percent: 10,
  },
  { category: "service", country: "GB", rate: 0.0, markup_percent: 10 },

  // United Arab Emirates (AE)
  { category: "marketing", country: "AE", rate: 0.0384, markup_percent: 10 },
  { category: "utility", country: "AE", rate: 0.0169, markup_percent: 10 },
  {
    category: "authentication",
    country: "AE",
    rate: 0.0183,
    markup_percent: 10,
  },
  { category: "service", country: "AE", rate: 0.0, markup_percent: 10 },

  // Saudi Arabia (SA)
  { category: "marketing", country: "SA", rate: 0.0325, markup_percent: 10 },
  { category: "utility", country: "SA", rate: 0.0143, markup_percent: 10 },
  {
    category: "authentication",
    country: "SA",
    rate: 0.0155,
    markup_percent: 10,
  },
  { category: "service", country: "SA", rate: 0.0, markup_percent: 10 },

  // Brazil (BR)
  { category: "marketing", country: "BR", rate: 0.0625, markup_percent: 10 },
  { category: "utility", country: "BR", rate: 0.008, markup_percent: 10 },
  {
    category: "authentication",
    country: "BR",
    rate: 0.0315,
    markup_percent: 10,
  },
  { category: "service", country: "BR", rate: 0.0, markup_percent: 10 },

  // Indonesia (ID)
  { category: "marketing", country: "ID", rate: 0.0411, markup_percent: 10 },
  { category: "utility", country: "ID", rate: 0.005, markup_percent: 10 },
  { category: "authentication", country: "ID", rate: 0.03, markup_percent: 10 },
  { category: "service", country: "ID", rate: 0.0, markup_percent: 10 },

  // Mexico (MX)
  { category: "marketing", country: "MX", rate: 0.0436, markup_percent: 10 },
  { category: "utility", country: "MX", rate: 0.0056, markup_percent: 10 },
  {
    category: "authentication",
    country: "MX",
    rate: 0.0263,
    markup_percent: 10,
  },
  { category: "service", country: "MX", rate: 0.0, markup_percent: 10 },

  // Germany (DE)
  { category: "marketing", country: "DE", rate: 0.1365, markup_percent: 10 },
  { category: "utility", country: "DE", rate: 0.06, markup_percent: 10 },
  {
    category: "authentication",
    country: "DE",
    rate: 0.0867,
    markup_percent: 10,
  },
  { category: "service", country: "DE", rate: 0.0, markup_percent: 10 },

  // Spain (ES)
  { category: "marketing", country: "ES", rate: 0.0615, markup_percent: 10 },
  { category: "utility", country: "ES", rate: 0.027, markup_percent: 10 },
  {
    category: "authentication",
    country: "ES",
    rate: 0.0391,
    markup_percent: 10,
  },
  { category: "service", country: "ES", rate: 0.0, markup_percent: 10 },

  // Italy (IT)
  { category: "marketing", country: "IT", rate: 0.0691, markup_percent: 10 },
  { category: "utility", country: "IT", rate: 0.0304, markup_percent: 10 },
  {
    category: "authentication",
    country: "IT",
    rate: 0.0439,
    markup_percent: 10,
  },
  { category: "service", country: "IT", rate: 0.0, markup_percent: 10 },

  // Nigeria (NG)
  { category: "marketing", country: "NG", rate: 0.0516, markup_percent: 10 },
  { category: "utility", country: "NG", rate: 0.0066, markup_percent: 10 },
  {
    category: "authentication",
    country: "NG",
    rate: 0.0295,
    markup_percent: 10,
  },
  { category: "service", country: "NG", rate: 0.0, markup_percent: 10 },

  // South Africa (ZA)
  { category: "marketing", country: "ZA", rate: 0.038, markup_percent: 10 },
  { category: "utility", country: "ZA", rate: 0.0049, markup_percent: 10 },
  {
    category: "authentication",
    country: "ZA",
    rate: 0.0202,
    markup_percent: 10,
  },
  { category: "service", country: "ZA", rate: 0.0, markup_percent: 10 },

  // Global Fallback (default if no specific country rule)
  { category: "marketing", country: "Global", rate: 0.075, markup_percent: 10 },
  { category: "utility", country: "Global", rate: 0.015, markup_percent: 10 },
  {
    category: "authentication",
    country: "Global",
    rate: 0.015,
    markup_percent: 10,
  },
  { category: "service", country: "Global", rate: 0.0, markup_percent: 10 },
];

// ============================================================
// AI MODEL PRICING (Per 1 Million Tokens - USD)
// Source: OpenAI Official Pricing 2024/2025
// ============================================================
const AI_MODEL_PRICING = [
  // ──────────────── PREMIUM TIER ────────────────
  {
    model: "gpt-4o",
    description: "Most capable model for complex output generation",
    recommended_for: "output",
    category: "premium",
    input_rate: 2.5, // $2.50 per 1M input tokens
    output_rate: 10.0, // $10.00 per 1M output tokens
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.5",
    description:
      "Most capable GPT model with enhanced creativity and nuanced understanding",
    recommended_for: "output",
    category: "premium",
    input_rate: 75.0,
    output_rate: 150.0,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-5",
    description: "Next generation GPT model",
    recommended_for: "output",
    category: "premium",
    input_rate: 100.0,
    output_rate: 300.0,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },

  // ──────────────── MID-TIER ────────────────
  {
    model: "gpt-4.1-mini",
    description: "Balanced performance and cost for general tasks",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 0.4,
    output_rate: 1.6,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.5-mini",
    description: "Smaller version of GPT-4.5 with good performance",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 7.5,
    output_rate: 15.0,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-5-mini",
    description: "Compact GPT-5 model for efficient deployment",
    recommended_for: "both",
    category: "mid-tier",
    input_rate: 8.0,
    output_rate: 24.0,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },

  // ──────────────── BUDGET TIER ────────────────
  {
    model: "gpt-4o-mini",
    description: "Fast and affordable for input classification tasks",
    recommended_for: "input",
    category: "budget",
    input_rate: 0.15,
    output_rate: 0.6,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.1-nano",
    description:
      "Ultra-low-cost model for simple classification and extraction",
    recommended_for: "input",
    category: "budget",
    input_rate: 0.1,
    output_rate: 0.4,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "gpt-4.5-nano",
    description: "Smallest GPT-4.5 variant for cost-sensitive applications",
    recommended_for: "input",
    category: "budget",
    input_rate: 1.5,
    output_rate: 3.0,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },

  // ──────────────── REASONING MODELS ────────────────
  {
    model: "o3",
    description:
      "Advanced reasoning model with superior problem-solving ability",
    recommended_for: "output",
    category: "reasoning",
    input_rate: 10.0,
    output_rate: 40.0,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "o3-mini",
    description: "Cost-efficient reasoning model",
    recommended_for: "both",
    category: "reasoning",
    input_rate: 1.1,
    output_rate: 4.4,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
  {
    model: "o4-mini",
    description: "Next-gen reasoning model for complex decision making",
    recommended_for: "both",
    category: "reasoning",
    input_rate: 1.1,
    output_rate: 4.4,
    markup_percent: 10,
    usd_to_inr_rate: 85.0,
    is_active: true,
  },
];

// ============================================================
// SEED FUNCTIONS
// ============================================================

const seedMetaTemplatePricing = async () => {
  console.log("\n📦 Seeding Meta WhatsApp Template Pricing...\n");
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
          `  ✅ Added: ${rule.category.padEnd(14)} | ${rule.country.padEnd(6)} | $${rule.rate.toFixed(4)}`,
        );
        added++;
      } else {
        // Update existing record to ensure markup is 10%
        await existing.update({ rate: rule.rate, markup_percent: 10 });
        console.log(
          `  🔄 Updated: ${rule.category.padEnd(14)} | ${rule.country.padEnd(6)} | $${rule.rate.toFixed(4)}`,
        );
        skipped++;
      }
    } catch (error) {
      console.error(
        `  ❌ Error: ${rule.category} / ${rule.country}:`,
        error.message,
      );
    }
  }

  console.log(
    `\n  📊 Meta Pricing Summary: ${added} added, ${skipped} updated`,
  );
};

const seedAiModelPricing = async () => {
  console.log("\n🤖 Seeding AI Model Pricing...\n");
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
          `  ✅ Added: ${model.model.padEnd(20)} | ${model.category.padEnd(9)} | Input: $${model.input_rate.toFixed(2)}/M | Output: $${model.output_rate.toFixed(2)}/M`,
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
          `  🔄 Updated: ${model.model.padEnd(20)} | ${model.category.padEnd(9)} | Input: $${model.input_rate.toFixed(2)}/M | Output: $${model.output_rate.toFixed(2)}/M`,
        );
        skipped++;
      }
    } catch (error) {
      console.error(`  ❌ Error: ${model.model}:`, error.message);
    }
  }

  console.log(`\n  📊 AI Model Summary: ${added} added, ${skipped} updated`);
};

// ============================================================
// MAIN EXECUTION
// ============================================================

const seedAllPricing = async () => {
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );
  console.log("       MASTER PRICING SEED SCRIPT - 10% PLATFORM MARKUP");
  console.log(
    "═══════════════════════════════════════════════════════════════",
  );

  try {
    console.log("\n🔌 Connecting to database...");
    await db.sequelize.authenticate();
    console.log("✅ Database connected successfully!\n");

    // Seed Meta Template Pricing
    await seedMetaTemplatePricing();

    // Seed AI Model Pricing
    await seedAiModelPricing();

    console.log(
      "\n═══════════════════════════════════════════════════════════════",
    );
    console.log("       ✅ ALL PRICING DATA SEEDED SUCCESSFULLY!");
    console.log(
      "═══════════════════════════════════════════════════════════════",
    );
    console.log("\n📝 Notes:");
    console.log(
      "   \u2022 All markup_percent values are set to 10 (10% platform markup)",
    );
    console.log("   • Super Admin can adjust markup via dashboard later");
    console.log("   • USD to INR rate is set to 85.0 for AI models");
    console.log("\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ SEED FAILED:", error);
    process.exit(1);
  }
};

// Run the seed
seedAllPricing();
