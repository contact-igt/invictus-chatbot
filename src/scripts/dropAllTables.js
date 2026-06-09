import db from "../database/index.js";

async function dropAllTables() {
  console.log(
    "⚠️  WARNING: This will DROP (delete) ALL tables from the database!\n",
  );

  try {
    const [tables] = await db.sequelize.query("SHOW TABLES");
    const tableNames = tables.map((row) => Object.values(row)[0]);

    if (tableNames.length === 0) {
      console.log("No tables found in the database.");
      process.exit(0);
    }

    console.log(`Found ${tableNames.length} tables. Dropping all...\n`);

    await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 0");

    for (const tableName of tableNames) {
      console.log(`  Dropping: ${tableName}`);
      await db.sequelize.query(`DROP TABLE IF EXISTS \`${tableName}\``);
    }

    await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 1");

    console.log(`\n✅ All ${tableNames.length} tables dropped successfully.`);
    process.exit(0);
  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    try {
      await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
    } catch (_) {}
    process.exit(1);
  }
}

dropAllTables();
