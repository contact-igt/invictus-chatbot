import db from "../database/index.js";

async function cleanupAllIndexes() {
    const tablesToCleanup = [
        {
            name: "leads",
            keep: ["PRIMARY", "idx_lead_status", "idx_lead_heat", "unique_lead_contact_active", "idx_lead_last_message", "idx_lead_deleted"]
        },
        {
            name: "contacts",
            keep: ["PRIMARY", "unique_contact_phone_tenant", "idx_contact_wa_id", "idx_contact_last_message", "idx_contact_blocked", "idx_contact_deleted"]
        },
        {
            name: "knowledge_sources",
            keep: ["PRIMARY", "idx_ks_status", "idx_ks_type", "idx_ks_deleted"]
        },
        {
            name: "whatsapp_templates",
            keep: ["PRIMARY", "unique_template_id", "unique_tenant_template_name"]
        }
    ];

    try {
        for (const table of tablesToCleanup) {
            console.log(`--- Cleaning up table: ${table.name} ---`);

            const [results] = await db.sequelize.query(`SHOW INDEX FROM \`${table.name}\``);

            const indexesToDrop = results
                .filter(idx => !table.keep.includes(idx.Key_name))
                .map(idx => idx.Key_name);

            const uniqueIndexesToDrop = [...new Set(indexesToDrop)];

            if (uniqueIndexesToDrop.length === 0) {
                console.log(`No redundant indexes found for ${table.name}.`);
                continue;
            }

            console.log(`Found ${uniqueIndexesToDrop.length} redundant indexes for ${table.name}.`);

            for (const idxName of uniqueIndexesToDrop) {
                try {
                    console.log(`Dropping index ${idxName} from ${table.name}...`);
                    await db.sequelize.query(`ALTER TABLE \`${table.name}\` DROP INDEX \`${idxName}\``);
                } catch (dropErr) {
                    console.error(`Failed to drop ${idxName} from ${table.name}:`, dropErr.message);
                }
            }
        }

        console.log("\n✅ All clean! Your database has been purged of redundant indexes.");
        process.exit(0);
    } catch (err) {
        console.error("Cleanup failed:", err);
        process.exit(1);
    }
}

cleanupAllIndexes();
