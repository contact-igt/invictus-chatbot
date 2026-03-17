/**
 * Seed Script: Populates `pricing_table` with Meta's official rates.
 * Run: node src/database/seedPricingTable.js
 * 
 * These are Meta's per-conversation rates (as of 2024/2025).
 * The Super Admin can later adjust `markup_percent` via the dashboard.
 */
import db from "./index.js";

const SEED_DATA = [
  // India (IN) - Primary market
  { category: "marketing",      country: "IN", rate: 0.0107, markup_percent: 0 },
  { category: "utility",        country: "IN", rate: 0.0042, markup_percent: 0 },
  { category: "authentication", country: "IN", rate: 0.0028, markup_percent: 0 },

  // United States (US)
  { category: "marketing",      country: "US", rate: 0.0250, markup_percent: 0 },
  { category: "utility",        country: "US", rate: 0.0150, markup_percent: 0 },
  { category: "authentication", country: "US", rate: 0.0135, markup_percent: 0 },

  // United Kingdom (GB)
  { category: "marketing",      country: "GB", rate: 0.0529, markup_percent: 0 },
  { category: "utility",        country: "GB", rate: 0.0233, markup_percent: 0 },
  { category: "authentication", country: "GB", rate: 0.0337, markup_percent: 0 },

  // Global Fallback (default if no specific country rule)
  { category: "marketing",      country: "Global", rate: 0.0750, markup_percent: 0 },
  { category: "utility",        country: "Global", rate: 0.0150, markup_percent: 0 },
  { category: "authentication", country: "Global", rate: 0.0150, markup_percent: 0 },
];

const seedPricingTable = async () => {
  try {
    console.log("[SEED] Connecting to database...");
    await db.sequelize.authenticate();
    console.log("[SEED] Connected. Seeding pricing_table...");

    for (const rule of SEED_DATA) {
      // Upsert: insert only if no existing rule for this category+country
      const existing = await db.PricingTable.findOne({
        where: { category: rule.category, country: rule.country },
      });

      if (!existing) {
        await db.PricingTable.create(rule);
        console.log(`  ✅ Added: ${rule.category} / ${rule.country} = ${rule.rate}`);
      } else {
        console.log(`  ⏭️  Skipped (exists): ${rule.category} / ${rule.country}`);
      }
    }

    console.log("[SEED] ✅ Pricing table seeded successfully!");
    process.exit(0);
  } catch (error) {
    console.error("[SEED] ❌ Error:", error);
    process.exit(1);
  }
};

seedPricingTable();
