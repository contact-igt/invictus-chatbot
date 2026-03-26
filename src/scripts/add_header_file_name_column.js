import db from "../database/index.js";

async function run() {
  try {
    const Query = `ALTER TABLE whatsapp_campaigns ADD COLUMN header_file_name VARCHAR(255) NULL COMMENT 'Original filename for header media';`;
    await db.sequelize.query(Query);
    console.log(
      "Column header_file_name added to whatsapp_campaigns table successfully.",
    );
  } catch (err) {
    if (
      err.message.includes("Duplicate column name") ||
      err.message.includes("already exists")
    ) {
      console.log("Column header_file_name already exists.");
    } else {
      console.error("Error adding column:", err.message);
    }
  }
  process.exit(0);
}

run();
