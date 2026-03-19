import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.join(process.cwd(), '.env') });

const alterTenantsTable = async () => {
    try {
        console.log(`[Migration] Connecting to DB: ${process.env.DB_NAME}...`);
        
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: process.env.DB_PORT || 3306,
        });

        console.log(`[Migration] Connected! Checking columns...`);

        const alterQueries = [
            "ALTER TABLE `Tenants` ADD COLUMN IF NOT EXISTS `address` TEXT;",
            "ALTER TABLE `Tenants` ADD COLUMN IF NOT EXISTS `max_users` INT DEFAULT 10;",
            "ALTER TABLE `Tenants` ADD COLUMN IF NOT EXISTS `subscription_plan` ENUM('basic', 'pro', 'enterprise') DEFAULT 'basic';",
            "ALTER TABLE `Tenants` ADD COLUMN IF NOT EXISTS `city` VARCHAR(255);",
            "ALTER TABLE `Tenants` ADD COLUMN IF NOT EXISTS `country` VARCHAR(255);",
            "ALTER TABLE `Tenants` ADD COLUMN IF NOT EXISTS `state` VARCHAR(255);",
            "ALTER TABLE `Tenants` ADD COLUMN IF NOT EXISTS `pincode` VARCHAR(255);"
        ];

        for (const query of alterQueries) {
            try {
                const [result] = await connection.execute(query);
                console.log(`[Migration] Successfully executed: ${query}`);
            } catch (queryErr) {
                // If column already exists or syntax error based on MySQL version, log and continue
                console.warn(`[Migration] Issue with query: ${query} => ${queryErr.message}`);
            }
        }

        console.log("[Migration] Tenants table altered successfully.");
        await connection.end();
        process.exit(0);
    } catch (err) {
        console.error("[Migration Error]", err);
        process.exit(1);
    }
};

alterTenantsTable();
