import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";

async function run() {
  try {
    console.log(
      `Starting migration: create table ${tableNames.APPOINTMENT_OUTCOMES}`,
    );

    const [rows] = await db.sequelize.query(
      `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      `,
      { replacements: [tableNames.APPOINTMENT_OUTCOMES] },
    );

    if (rows.length > 0) {
      console.log(
        `${tableNames.APPOINTMENT_OUTCOMES} already exists. Skipping.`,
      );
      return;
    }

    await db.sequelize.query(
      `
      CREATE TABLE ${tableNames.APPOINTMENT_OUTCOMES} (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        appointment_id VARCHAR(255) NOT NULL,
        tenant_id VARCHAR(255) NOT NULL,
        notes TEXT NOT NULL,
        follow_up_required TINYINT(1) NOT NULL DEFAULT 0,
        follow_up_date DATE NULL,
        follow_up_type ENUM('Call','Visit','WhatsApp') NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_outcome_tenant_appointment (tenant_id, appointment_id),
        INDEX idx_outcome_follow_up_date (follow_up_date)
      )
      `,
    );

    console.log(
      `Migration complete: ${tableNames.APPOINTMENT_OUTCOMES} created.`,
    );
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  } finally {
    await db.sequelize.close();
  }
}

run();
