import db from "../database/index.js";

async function verifySystemSchema() {
    const tablesToCheck = [
        "contacts", "leads", "knowledge_sources", "tenants",
        "tenant_users", "tenant_invitations", "messages",
        "whatsapp_templates", "whatsapp_accounts"
    ];

    console.log("=== GLOBAL SCHEMA VERIFICATION ===\n");

    try {
        for (const table of tablesToCheck) {
            console.log(`Checking table: ${table}...`);

            // Check columns
            const [columns] = await db.sequelize.query(`DESCRIBE \`${table}\``);
            const colNames = columns.map(c => c.Field);
            const hasIsDeleted = colNames.includes("is_deleted");
            const hasDeletedAt = colNames.includes("deleted_at");

            // Check indexes
            const [indexes] = await db.sequelize.query(`SHOW INDEX FROM \`${table}\``);
            const indexNames = [...new Set(indexes.map(i => i.Key_name))];

            console.log(`  - Columns: ${hasIsDeleted ? "✅ is_deleted" : "❌ is_deleted"} | ${hasDeletedAt ? "✅ deleted_at" : "❌ deleted_at"}`);
            console.log(`  - Total Indexes: ${indexNames.length}`);
            console.log(`  - Index Names: ${indexNames.join(", ")}`);

            if (indexNames.length > 20) {
                console.warn(`  - ⚠️ WARNING: High index count detected!`);
            }
            console.log("");
        }

        console.log("Verification complete.");
        process.exit(0);
    } catch (err) {
        console.error("Verification failed:", err);
        process.exit(1);
    }
}

verifySystemSchema();
