import db from "../database/index.js";

async function run() {
  try {
    const Query = `ALTER TABLE messages ADD COLUMN media_filename VARCHAR(255) NULL COMMENT 'Original filename for document/media messages';`;
    await db.sequelize.query(Query);
    console.log("Column media_filename added to messages table successfully.");
  } catch (err) {
    if (
      err.message.includes("Duplicate column name") ||
      err.message.includes("already exists")
    ) {
      console.log("Column media_filename already exists.");
    } else {
      console.error("Error adding column:", err.message);
    }
  }
  process.exit(0);
}

run();
