import db from "../database/index.js";

async function truncateAllTables() {
    console.log("⚠️  WARNING: This will delete ALL data in ALL tables!");

    try {
        // 1. Get all table names
        const [tables] = await db.sequelize.query("SHOW TABLES");
        const tableNames = tables.map(row => Object.values(row)[0]);

        if (tableNames.length === 0) {
            console.log("No tables found in the database.");
            process.exit(0);
        }

        console.log(`Found ${tableNames.length} tables. Starting truncation...`);

        // 2. Disable foreign key checks to allow truncation of related tables
        await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 0");

        // 3. Truncate each table
        for (const tableName of tableNames) {
            console.log(`Truncating table: ${tableName}...`);
            await db.sequelize.query(`TRUNCATE TABLE \`${tableName}\``);
        }

        // 4. Re-enable foreign key checks
        await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 1");

        console.log("\n✅ SUCCESS: All tables have been truncated successfully.");
        process.exit(0);
    } catch (err) {
        console.error("\n❌ ERROR during truncation:", err.message);

        // Attempt to re-enable foreign key checks even if it failed
        try {
            await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
        } catch (ignore) { }

        process.exit(1);
    }
}

truncateAllTables();
