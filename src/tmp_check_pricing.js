import "dotenv/config";
import db from "./database/index.js";
import { tableNames } from "./database/tableName.js";

async function checkData() {
  try {
    const [rows] = await db.sequelize.query(`SELECT COUNT(*) as count FROM ${tableNames.PRICING_TABLE}`);
    console.log(`Table ${tableNames.PRICING_TABLE} has ${rows[0].count} records.`);
    
    if (rows[0].count > 0) {
      const [data] = await db.sequelize.query(`SELECT * FROM ${tableNames.PRICING_TABLE} LIMIT 5`);
      console.log("Sample Data:", JSON.stringify(data, null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

checkData();
