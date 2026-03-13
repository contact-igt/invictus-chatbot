import db from "./src/database/index.js";
import { tableNames } from "./src/database/tableName.js";

async function checkAccount() {
  try {
    const [rows] = await db.sequelize.query(`SELECT * FROM ${tableNames.WHATSAPP_ACCOUNT}`);
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkAccount();
