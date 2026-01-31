import db from "../database/index.js";

async function aggressiveCleanup() {
    const tables = ["leads", "contacts", "whatsapp_templates", "knowledge_sources"];

    try {
        for (const tableName of tables) {
            console.log(`Aggressive cleanup for ${tableName}...`);
            const [indexes] = await db.sequelize.query(`SHOW INDEX FROM \`${tableName}\``);

            const toDrop = [...new Set(indexes.filter(i => i.Key_name !== "PRIMARY").map(i => i.Key_name))];

            for (const idx of toDrop) {
                try {
                    console.log(`Dropping ${idx} from ${tableName}`);
                    await db.sequelize.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${idx}\``);
                } catch (e) {
                    console.error(`Error dropping ${idx}: ${e.message}`);
                }
            }
        }
        console.log("Cleanup complete.");
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

aggressiveCleanup();
