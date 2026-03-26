import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";

/**
 * Migration script to add input_model and output_model to existing tenants' ai_settings.
 * Run this AFTER running seed_all_pricing.js to ensure models are available.
 */
async function run() {
  try {
    console.log("Starting tenant AI model migration...\n");

    // Fetch all non-deleted tenants
    const [tenants] = await db.sequelize.query(`
      SELECT id, tenant_id, ai_settings
      FROM ${tableNames.TENANTS}
      WHERE is_deleted = 0
    `);

    console.log(`Found ${tenants.length} tenants to process.\n`);

    let updated = 0;
    let skipped = 0;

    for (const tenant of tenants) {
      let settings = tenant.ai_settings;

      // Parse JSON if string
      if (typeof settings === "string") {
        try {
          settings = JSON.parse(settings);
        } catch {
          settings = {};
        }
      }

      if (!settings) {
        settings = {};
      }

      // Check if already has model selections
      if (settings.input_model && settings.output_model) {
        skipped++;
        continue;
      }

      // Add default model selections
      const updatedSettings = {
        ...settings,
        input_model: settings.input_model || "gpt-4o-mini",
        output_model: settings.output_model || "gpt-4o",
      };

      await db.sequelize.query(
        `UPDATE ${tableNames.TENANTS} SET ai_settings = ? WHERE id = ?`,
        { replacements: [JSON.stringify(updatedSettings), tenant.id] },
      );

      updated++;
      console.log(`✅ Updated tenant: ${tenant.tenant_id}`);
    }

    console.log(`\n========================================`);
    console.log(`Migration complete!`);
    console.log(`  Updated: ${updated} tenants`);
    console.log(`  Skipped: ${skipped} tenants (already have model settings)`);
    console.log(`========================================\n`);
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  }

  process.exit(0);
}

run();
