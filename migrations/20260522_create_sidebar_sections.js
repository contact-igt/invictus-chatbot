/**
 * Migration: create sidebar_sections table
 *
 * Run manually (from Backend/):
 *   node migrations/20260522_create_sidebar_sections.js
 *   node migrations/20260522_create_sidebar_sections.js down
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const UP = `
  CREATE TABLE IF NOT EXISTS ${tableNames.SIDEBAR_SECTIONS} (
    id INT NOT NULL AUTO_INCREMENT,
    sidebar_section_id VARCHAR(255) NOT NULL,
    section_key VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    assignment_mode ENUM('global','scoped') NOT NULL DEFAULT 'global',
    is_visible TINYINT(1) NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_system_core TINYINT(1) NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    metadata JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_sidebar_section_id (sidebar_section_id),
    UNIQUE KEY unique_sidebar_section_key (section_key),
    KEY idx_sidebar_sections_active (is_active),
    KEY idx_sidebar_sections_visible (is_visible),
    KEY idx_sidebar_sections_sort_order (sort_order),
    KEY idx_sidebar_sections_assignment_mode (assignment_mode)
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS ${tableNames.SIDEBAR_SECTIONS};
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  