import db from "../database/index.js";

async function nuclearPurge() {
    try {
        const [tables] = await db.sequelize.query("SHOW TABLES");
        console.log(`Found ${tables.length} tables. Starting nuclear index purge...`);

        for (const tableRow of tables) {
            const tableName = Object.values(tableRow)[0];
            console.log(`\n--- Purging table: ${tableName} ---`);

            const [indexes] = await db.sequelize.query(`SHOW INDEX FROM \`${tableName}\``);

            const toDrop = [...new Set(indexes.filter(i => i.Key_name !== "PRIMARY").map(i => i.Key_name))];

            if (toDrop.length === 0) {
                console.log(`No non-primary indexes found for ${tableName}.`);
                continue;
            }

            console.log(`Found ${toDrop.length} non-primary indexes. Dropping...`);

            for (const idxName of toDrop) {
                try {
                    console.log(`Dropping index: ${idxName}`);
                    await db.sequelize.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${idxName}\``);
                } catch (err) {
                    console.error(`Failed to drop ${idxName}: ${err.message}`);
                }
            }
        }

        console.log("\n✅ NUCLEAR PURGE COMPLETE. All tables are reset to PRIMARY KEY only.");
        console.log("Next step: Start the server with sync({ alter: true }) once to recreate named indexes.");
        process.exit(0);
    } catch (err) {
        console.error("NUCLEAR PURGE FAILED:", err);
        process.exit(1);
    }
}

nuclearPurge();
