import db from "../database/index.js";

async function diagnostic() {
    try {
        const [tables] = await db.sequelize.query("SHOW TABLES");
        for (const tableRow of tables) {
            const tableName = Object.values(tableRow)[0];
            const [indexes] = await db.sequelize.query(`SHOW INDEX FROM \`${tableName}\``);
            const indexNames = indexes.map(i => i.Key_name);
            console.log(`Table: ${tableName} -> ${indexNames.length} indexes: ${indexNames.join(", ")}`);
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

diagnostic();
