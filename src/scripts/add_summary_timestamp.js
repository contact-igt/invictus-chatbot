
import db from "../database/index.js";

const runMigration = async () => {
    try {
        console.log("Checking if ai_summary_created_at column exists in leads table...");

        // Check if column exists
        const [columns] = await db.sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = '${db.sequelize.config.database}' 
      AND TABLE_NAME = 'leads' 
      AND COLUMN_NAME = 'ai_summary_created_at'
    `);

        if (columns.length > 0) {
            console.log("Column 'ai_summary_created_at' already exists. Skipping.");
        } else {
            console.log("Adding 'ai_summary_created_at' column...");
            await db.sequelize.query(`
        ALTER TABLE leads 
        ADD COLUMN ai_summary_created_at DATETIME NULL;
      `);
            console.log("Column added successfully.");
        }

        process.exit(0);
    } catch (error) {
        console.error("Migration failed:", error);
        process.exit(1);
    }
};

runMigration();
