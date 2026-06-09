/**
 * Migration: create sidebar_section_plans table
 *
 * Run manually (from Backend/):
 *   node migrations/20260522_create_sidebar_section_plans.js
 *   node migrations/20260522_create_sidebar_section_plans.js down
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const UP = `
  CREATE TABLE IF NOT EXISTS ${tableNames.SIDEBAR_SECTION_PLANS} (
    id INT NOT NULL AUTO_INCREMENT,
    sidebar_section_plan_id VARCHAR(255) NOT NULL,
    sidebar_section_id VARCHAR(255) NOT NULL,
    plan_id VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    metadata JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_sidebar_section_plan_id (sidebar_section_plan_id),
    UNIQUE KEY unique_sidebar_section_plan_map (sidebar_section_id, plan_id),
    KEY idx_sidebar_section_plans_section (sidebar_section_id),
    KEY idx_sidebar_section_plans_plan (plan_id),
    KEY idx_sidebar_section_plans_active (is_active),
    CONSTRAINT fk_sidebar_section_plans_section
      FOREIGN KEY (sidebar_section_id)
      REFERENCES ${tableNames.SIDEBAR_SECTIONS}(sidebar_section_id)
      ON UPDATE CASCADE
      ON DELETE CASCADE,
    CONSTRAINT fk_sidebar_section_plans_plan
      FOREIGN KEY (plan_id)
      REFERENCES ${tableNames.PLANS}(plan_id)
      ON UPDATE CASCADE
      ON DELETE CASCADE
  );
`;

const DOWN = `
  DROP TABLE IF EXISTS ${tableNames.SIDEBAR_SECTION_PLANS};
`;

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  const sql = direction === "down" ? DOWN : UP;
  