/**
 * Migration: create sidebar_section_tenants table
 *
 * Run manually (from Backend/):
 *   node migrations/20260522_create_sidebar_section_tenants.js
 *   node migrations/20260522_create_sidebar_section_tenants.js down
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const UP = `
  CREATE TABLE IF NOT EXISTS ${tableNames.SIDEBAR_SECTION_TENANTS} (
    id INT NOT NULL AUTO_INCREMENT,
    sidebar_section_tenant_id VARCHAR(255) NOT NULL,
    sidebar_section_id VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    title_override VARCHAR(255) NULL,
    is_visible_override TINYINT(1) NULL,
    sort_order_override INT NULL,
    metadata JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_sidebar_section_tenant_id (sidebar_section_tenant_id),
    UNIQUE KEY unique_sidebar_section_tenant_map (sidebar_section_id, tenant_id),
    KEY idx_sidebar_section_tenants_section (sidebar_section_id),
    KEY idx_sidebar_section_tenants_tenant (tenant_id),
    KEY idx_sidebar_section_tenants_active (is_active),
    CONSTRAINT fk_sidebar_section_tenants_section
      FOREIGN KEY (sidebar_section_id)
      REFERENCES ${tableNames.SIDEBAR_SECTIONS}(sidebar_section_id)
      ON UPDATE CASCADE
      ON DELETE CASCADE,
    CONSTRAINT fk_sidebar_section_tenants_tenant
      FOREIGN KEY (tenant_id)
      REFERENCES ${tableNames.TENANTS}(tenant_id)
      ON UPDATE CASCADE
      ON DELETE CASCADE
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS ${tableNames.SIDEBAR_SECTION_TENANTS};
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  