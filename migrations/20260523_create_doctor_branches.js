/**
 * Migration: create doctor_branches table
 *
 * Run manually (from Backend/):
 *   node migrations/20260523_create_doctor_branches.js
 *   node migrations/20260523_create_doctor_branches.js down
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const UP = `
  CREATE TABLE IF NOT EXISTS ${tableNames.DOCTOR_BRANCHES} (
    id INT NOT NULL AUTO_INCREMENT,
    doctor_id VARCHAR(50) NOT NULL,
    branch_id VARCHAR(50) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_doctor_branch_tenant (tenant_id, doctor_id, branch_id),
    KEY idx_db_doctor (tenant_id, doctor_id),
    KEY idx_db_branch (tenant_id, branch_id),
    KEY idx_db_primary (tenant_id, doctor_id, is_primary)
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS ${tableNames.DOCTOR_BRANCHES};
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  