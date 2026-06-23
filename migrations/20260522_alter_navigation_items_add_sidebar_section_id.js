/**
 * Migration: add sidebar_section_id to navigation_items
 *
 * Run manually (from Backend/):
 *   node migrations/20260522_alter_navigation_items_add_sidebar_section_id.js
 *   node migrations/20260522_alter_navigation_items_add_sidebar_section_id.js down
 */

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const getCurrentSchema = async () => {
  const rows = await db.sequelize.query("SELECT DATABASE() AS db_name", {
    type: db.Sequelize.QueryTypes.SELECT,
  });
  return rows[0]?.db_name;
};

const getIndexMap = async (tableName, schemaName) => {
  const rows = await db.sequelize.query(
    `
      SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = :schemaName
        AND TABLE_NAME = :tableName
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `,
    {
      replacements: { schemaName, tableName },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.INDEX_NAME)) {
      map.set(row.INDEX_NAME, {
        nonUnique: Number(row.NON_UNIQUE),
        columns: [],
      });
    }
    map.get(row.INDEX_NAME).columns.push(row.COLUMN_NAME);
  }
  return map;
};

const hasIndexName = (indexMap, indexName) => indexMap.has(indexName);

const hasEquivalentIndex = (indexMap, columns) => {
  const target = columns.join("|").toLowerCase();
  for (const index of indexMap.values()) {
    const cols = index.columns.join("|").toLowerCase();
    if (cols === target) return true;
  }
  return false;
};

const ensureIndex = async (tableName, indexName, columns) => {
  const schemaName = await getCurrentSchema();
  const indexMap = await getIndexMap(tableName, schemaName);

  if (hasIndexName(indexMap, indexName)) return;
  if (hasEquivalentIndex(indexMap, columns)) return;

  const cols = columns.map((c) => `\`${c}\``).join(", ");
  await db.sequelize.query(
    `ALTER TABLE \`${tableName}\` ADD KEY \`${indexName}\` (${cols})`,
  );
};

const getFkRows = async (tableName, schemaName) =>
  db.sequelize.query(
    `
      SELECT
        kcu.CONSTRAINT_NAME,
        kcu.COLUMN_NAME,
        kcu.REFERENCED_TABLE_NAME,
        kcu.REFERENCED_COLUMN_NAME,
        rc.UPDATE_RULE,
        rc.DELETE_RULE
      FROM information_schema.KEY_COLUMN_USAGE kcu
      JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
        ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
       AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
      WHERE kcu.TABLE_SCHEMA = :schemaName
        AND kcu.TABLE_NAME = :tableName
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
    `,
    {
      replacements: { schemaName, tableName },
      type: db.Sequelize.QueryTypes.SELECT,
    },
  );

const ensureForeignKey = async () => {
  const schemaName = await getCurrentSchema();
  const fkRows = await getFkRows(tableNames.NAVIGATION_ITEMS, schemaName);

  const fkByName = fkRows.some(
    (row) => row.CONSTRAINT_NAME === "fk_navigation_items_sidebar_section",
  );
  if (fkByName) return;

  const fkEquivalent = fkRows.some(
    (row) =>
      row.COLUMN_NAME === "sidebar_section_id" &&
      row.REFERENCED_TABLE_NAME === tableNames.SIDEBAR_SECTIONS &&
      row.REFERENCED_COLUMN_NAME === "sidebar_section_id",
  );
  if (fkEquivalent) return;

  const brokenRows = await db.sequelize.query(
    `
      SELECT COUNT(*) AS broken_count
      FROM ${tableNames.NAVIGATION_ITEMS} ni
      LEFT JOIN ${tableNames.SIDEBAR_SECTIONS} ss
        ON ss.sidebar_section_id = ni.sidebar_section_id
      WHERE ni.sidebar_section_id IS NOT NULL
        AND ss.sidebar_section_id IS NULL
    `,
    { type: db.Sequelize.QueryTypes.SELECT },
  );
  const brokenCount = Number(brokenRows[0]?.broken_count || 0);
  if (brokenCount > 0) {
    throw new Error(
      `Cannot add FK fk_navigation_items_sidebar_section: found broken references (${brokenCount})`,
    );
  }

  await db.sequelize.query(
    `
      ALTER TABLE ${tableNames.NAVIGATION_ITEMS}
      ADD CONSTRAINT fk_navigation_items_sidebar_section
      FOREIGN KEY (sidebar_section_id)
      REFERENCES ${tableNames.SIDEBAR_SECTIONS}(sidebar_section_id)
      ON UPDATE CASCADE
      ON DELETE SET NULL
    `,
  );
};

const dropIndexIfExists = async (tableName, indexName) => {
  const schemaName = await getCurrentSchema();
  const indexMap = await getIndexMap(tableName, schemaName);
  if (!hasIndexName(indexMap, indexName)) return;
  await db.sequelize.query(
    `ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``,
  );
};

const dropFkIfExists = async (tableName, constraintName) => {
  const schemaName = await getCurrentSchema();
  const fkRows = await getFkRows(tableName, schemaName);
  const exists = fkRows.some((row) => row.CONSTRAINT_NAME === constraintName);
  if (!exists) return;
  await db.sequelize.query(
    `ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\``,
  );
};

const up = async () => {
  await db.sequelize.query(
    `
      ALTER TABLE ${tableNames.NAVIGATION_ITEMS}
      ADD COLUMN IF NOT EXISTS sidebar_section_id VARCHAR(255) NULL AFTER menu_group
    `,
  );

  await ensureIndex(tableNames.NAVIGATION_ITEMS, "idx_navigation_items_sidebar_section", [
    "sidebar_section_id",
  ]);
  await ensureIndex(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_sidebar_section_sort",
    ["sidebar_section_id", "sort_order"],
  );
  await ensureIndex(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_tenant_sidebar_section_sort",
    ["tenant_id", "sidebar_section_id", "sort_order"],
  );

  await ensureForeignKey();
};

const down = async () => {
  await dropFkIfExists(
    tableNames.NAVIGATION_ITEMS,
    "fk_navigation_items_sidebar_section",
  );

  await dropIndexIfExists(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_tenant_sidebar_section_sort",
  );
  await dropIndexIfExists(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_sidebar_section_sort",
  );
  await dropIndexIfExists(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_sidebar_section",
  );

  await db.sequelize.query(
    `
      ALTER TABLE ${tableNames.NAVIGATION_ITEMS}
      DROP COLUMN IF EXISTS sidebar_section_id
    `,
  );
};

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  