import db from "./src/database/index.js";
import { tableNames } from "./src/database/tableName.js";

async function debug() {
  try {
    const [contacts] = await db.sequelize.query(`SELECT phone, contact_id FROM ${tableNames.CONTACTS} ORDER BY id DESC LIMIT 20`);
    console.log("Contacts Excerpts:", JSON.stringify(contacts, null, 2));

    const [messages] = await db.sequelize.query(`SELECT phone, contact_id, message FROM ${tableNames.MESSAGES} ORDER BY id DESC LIMIT 10`);
    console.log("Recent Messages:", JSON.stringify(messages, null, 2));

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

debug();
