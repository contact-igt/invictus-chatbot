import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";

const INDEX_NAME = "uq_outcome_tenant_appointment";

async function run() {
  try {
    console.log(
      `Starting migration: add ${INDEX_NAME} on ${tableNames.APPOINTMENT_OUTCOMES}`,
    );

    const [indexes] = await db.sequelize.query(
      `
      SELECT INDEX_NAME
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1
      `,
      { replacements: [tableNames.APPOINTMENT_OUTCOMES, INDEX_NAME] },
    );

    if (indexes.length > 0) {
      console.log(`${INDEX_NAME} already exists. Skipping.`);
      return;
    }

    await db.sequelize.query(
      `ALTER TABLE ${tableNames.APPOINTMENT_OUTCOMES}
       ADD UNIQUE INDEX ${INDEX_NAME} (tenant_id, appointment_id)`,
    );

    console.log(`Migration complete: ${INDEX_NAME} added.`);
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
}

run();
