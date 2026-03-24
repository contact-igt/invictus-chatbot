import db from "../database/index.js";

async function run() {
  try {
    const Query = `ALTER TABLE contacts ADD COLUMN is_ai_silenced BOOLEAN DEFAULT false;`;
    await db.sequelize.query(Query);
    console.log("Column is_ai_silenced added to contacts table successfully.");
  } catch (err) {
    if (
      err.message.includes("Duplicate column name") ||
      err.message.includes("already exists")
    ) {
      console.log("Column is_ai_silenced already exists.");
    } else {
      console.error("Error adding column:", err.message);
    }
  }
  process.exit(0);
}

run();
