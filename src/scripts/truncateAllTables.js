import db from "../database/index.js";

async function truncateAllTables() {
    

    try {
        // 1. Get all table names
        const [tables] = await db.sequelize.query("SHOW TABLES");
        const tableNames = tables.map(row => Object.values(row)[0]);

        if (tableNames.length === 0) {
            
            process.exit(0);
        }

        