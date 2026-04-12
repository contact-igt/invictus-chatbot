import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

async function check() {
  try {
    const [rows] = await db.sequelize.query(`SELECT id, tenant_id, whatsapp_number, status, is_deleted FROM ${tableNames.WHATSAPP_ACCOUNT}`);
    console.log("WhatsApp Accounts:");
    console.table(rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

check();
