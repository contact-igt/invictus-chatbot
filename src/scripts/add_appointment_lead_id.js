import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";

async function run() {
  try {
    console.log("Starting migration: add appointments.lead_id");

    const [columns] = await db.sequelize.query(
      `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = 'lead_id'
      `,
      { replacements: [tableNames.APPOINTMENTS] },
    );

    if (columns.length > 0) {
      console.log("lead_id already exists on appointments. Skipping.");
      return;
    }

    await db.sequelize.query(
      `ALTER TABLE ${tableNames.APPOINTMENTS}
       ADD COLUMN lead_id VARCHAR(255) NULL AFTER contact_id`,
    );

    console.log("Migration complete: appointments.lead_id added.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
}

run();
