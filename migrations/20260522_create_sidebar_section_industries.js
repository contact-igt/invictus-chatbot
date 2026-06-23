/**
 * Migration: create sidebar_section_industries table
 *
 * Run manually (from Backend/):
 *   node migrations/20260522_create_sidebar_section_industries.js
 *   node migrations/20260522_create_sidebar_section_industries.js down
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const UP = `
  CREATE TABLE IF NOT EXISTS ${tableNames.SIDEBAR_SECTION_INDUSTRIES} (
    id INT NOT NULL AUTO_INCREMENT,
    sidebar_section_industry_id VARCHAR(255) NOT NULL,
    sidebar_section_id VARCHAR(255) NOT NULL,
    industry_id VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    metadata JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_sidebar_section_industry_id (sidebar_section_industry_id),
    UNIQUE KEY unique_sidebar_section_industry_map (sidebar_section_id, industry_id),
    KEY idx_sidebar_section_industries_section (sidebar_section_id),
    KEY idx_sidebar_section_industries_industry (industry_id),
    KEY idx_sidebar_section_industries_active (is_active),
    CONSTRAINT fk_sidebar_section_industries_section
      FOREIGN KEY (sidebar_section_id)
      REFERENCES ${tableNames.SIDEBAR_SECTIONS}(sidebar_section_id)
      ON UPDATE CASCADE
      ON DELETE CASCADE,
    CONSTRAINT fk_sidebar_section_industries_industry
      FOREIGN KEY (industry_id)
      REFERENCES ${tableNames.INDUSTRIES}(industry_id)
      ON UPDATE CASCADE
      ON DELETE CASCADE
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS ${tableNames.SIDEBAR_SECTION_INDUSTRIES};
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  