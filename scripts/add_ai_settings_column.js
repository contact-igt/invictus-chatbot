import db from "../src/database/index.js";

async function run() {
  try {
    await db.sequelize.query(`
      ALTER TABLE tenants 
      ADD COLUMN ai_settings JSON DEFAULT NULL;
    `);
    
    // Setting default values
    const defaultJson = JSON.stringify({
      auto_responder: true,
      smart_reply: true,
      neural_summary: true,
      content_generation: true
    });

    await db.sequelize.query(`
      UPDATE tenants SET ai_settings = '${defaultJson}' WHERE ai_settings IS NULL;
    `);

    console.log("Column ai_settings added and backfilled to tenants table successfully.");
  } catch (err) {
    if (err.message && err.message.includes("Duplicate column name")) {
      console.log("Column ai_settings already exists in tenants table.");
    } else {
      console.error("Error altering tenants table:", err);
    }
  }
  process.exit(0);
}

run();
