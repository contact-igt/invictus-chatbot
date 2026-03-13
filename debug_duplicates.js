import db from "./src/database/index.js";
import { tableNames } from "./src/database/tableName.js";

async function debug() {
  try {
    const [duplicates] = await db.sequelize.query(`
      SELECT phone, contact_id, COUNT(*) as count 
      FROM ${tableNames.CONTACTS} 
      GROUP BY RIGHT(phone, 10), tenant_id
      HAVING count > 1
    `);
    console.log("Potential Duplicate Contacts (by last 10 digits):", JSON.stringify(duplicates, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

debug();
