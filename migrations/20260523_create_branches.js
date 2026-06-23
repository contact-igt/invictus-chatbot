/**
 * Migration: create branches table
 *
 * Run manually (from Backend/):
 *   node migrations/20260523_create_branches.js
 *   node migrations/20260523_create_branches.js down
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const UP = `
  CREATE TABLE IF NOT EXISTS ${tableNames.BRANCHES} (
    id INT NOT NULL AUTO_INCREMENT,
    branch_id VARCHAR(50) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) NULL,
    address TEXT NULL,
    city VARCHAR(255) NULL,
    state VARCHAR(255) NULL,
    country VARCHAR(255) NULL,
    pincode VARCHAR(50) NULL,
    phone VARCHAR(30) NULL,
    email VARCHAR(255) NULL,
    google_map_url TEXT NULL,
    is_main TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME NULL,
    created_by VARCHAR(255) NULL,
    updated_by VARCHAR(255) NULL,
    notes TEXT NULL,
    timezone VARCHAR(100) NULL,
    landmark VARCHAR(255) NULL,
    latitude DECIMAL(10,8) NULL,
    longitude DECIMAL(11,8) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_branch_id (branch_id),
    KEY idx_branch_tenant_deleted (tenant_id, is_deleted),
    KEY idx_branch_tenant_active_deleted (tenant_id, is_active, is_deleted),
    KEY idx_branch_tenant_main_deleted (tenant_id, is_main, is_deleted),
    KEY idx_branch_tenant_name (tenant_id, name),
    KEY idx_branch_tenant_code (tenant_id, code)
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS ${tableNames.BRANCHES};
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  