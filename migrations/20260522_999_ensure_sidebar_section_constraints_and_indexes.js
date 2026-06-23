

import db from "../src/database/index.js";
import { tableNames } from "../src/database/tableName.js";

const qi = db.sequelize.getQueryInterface();

const q = async (sql, replacements = {}, transaction) =>
  db.sequelize.query(sql, {
    replacements,
    type: db.Sequelize.QueryTypes.SELECT,
    transaction,
  });

const getCurrentSchema = async (transaction) => {
  const rows = await q("SELECT DATABASE() AS db_name", {}, transaction);
  return rows[0]?.db_name;
};

const getIndexMeta = async (tableName, schemaName, transaction) => {
  const rows = await q(
    `
      SELECT
        INDEX_NAME,
        NON_UNIQUE,
        SEQ_IN_INDEX,
        COLUMN_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = :schemaName
        AND TABLE_NAME = :tableName
      ORDER BY INDEX_NAME, SEQ_IN_INDEX
    `,
    { schemaName, tableName },
    transaction,
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

const indexNameExists = (indexMap, indexName) => indexMap.has(indexName);

const hasEquivalentIndex = (indexMap, columns, { unique = false } = {}) => {
  const targetCols = columns.join("|").toLowerCase();
  for (const index of indexMap.values()) {
    const cols = index.columns.join("|").toLowerCase();
    const isUnique = Number(index.nonUnique) === 0;
    if (cols === targetCols && isUnique === Boolean(unique)) {
      return true;
    }
  }
  return false;
};

const ensureIndex = async (
  tableName,
  indexName,
  columns,
  { unique = false } = {},
  transaction,
) => {
  const schemaName = await getCurrentSchema(transaction);
  const indexMap = await getIndexMeta(tableName, schemaName, transaction);

  if (indexNameExists(indexMap, indexName)) return false;
  if (hasEquivalentIndex(indexMap, columns, { unique })) return false;

  const quotedColumns = columns.map((column) => `\`${column}\``).join(", ");
  const uniqueSql = unique ? "UNIQUE " : "";
  await db.sequelize.query(
    `ALTER TABLE \`${tableName}\` ADD ${uniqueSql}KEY \`${indexName}\` (${quotedColumns})`,
    { transaction },
  );
  return true;
};

const getFkMeta = async (tableName, schemaName, transaction) => {
  return q(
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
      ORDER BY kcu.CONSTRAINT_NAME
    `,
    { schemaName, tableName },
    transaction,
  );
};

const fkNameExists = (fkRows, constraintName) =>
  fkRows.some((row) => row.CONSTRAINT_NAME === constraintName);

const hasEquivalentFk = (
  fkRows,
  { columnName, referencedTableName, referencedColumnName, onUpdate, onDelete },
) =>
  fkRows.some(
    (row) =>
      row.COLUMN_NAME === columnName &&
      row.REFERENCED_TABLE_NAME === referencedTableName &&
      row.REFERENCED_COLUMN_NAME === referencedColumnName &&
      String(row.UPDATE_RULE || "").toUpperCase() === String(onUpdate || "").toUpperCase() &&
      String(row.DELETE_RULE || "").toUpperCase() === String(onDelete || "").toUpperCase(),
  );

const assertNoBrokenReferences = async (
  tableName,
  columnName,
  referencedTableName,
  referencedColumnName,
  transaction,
) => {
  const rows = await q(
    `
      SELECT COUNT(*) AS broken_count
      FROM \`${tableName}\` t
      LEFT JOIN \`${referencedTableName}\` r
        ON r.\`${referencedColumnName}\` = t.\`${columnName}\`
      WHERE t.\`${columnName}\` IS NOT NULL
        AND r.\`${referencedColumnName}\` IS NULL
    `,
    {},
    transaction,
  );
  const brokenCount = Number(rows[0]?.broken_count || 0);
  if (brokenCount > 0) {
    throw new Error(
      `Broken references found before adding FK: ${tableName}.${columnName} -> ${referencedTableName}.${referencedColumnName} (count=${brokenCount})`,
    );
  }
};

const ensureForeignKey = async (
  tableName,
  {
    constraintName,
    columnName,
    referencedTableName,
    referencedColumnName,
    onUpdate,
    onDelete,
  },
  transaction,
) => {
  const schemaName = await getCurrentSchema(transaction);
  const fkRows = await getFkMeta(tableName, schemaName, transaction);

  if (fkNameExists(fkRows, constraintName)) return false;
  if (
    hasEquivalentFk(fkRows, {
      columnName,
      referencedTableName,
      referencedColumnName,
      onUpdate,
      onDelete,
    })
  ) {
    return false;
  }

  await assertNoBrokenReferences(
    tableName,
    columnName,
    referencedTableName,
    referencedColumnName,
    transaction,
  );

  await db.sequelize.query(
    `
      ALTER TABLE \`${tableName}\`
      ADD CONSTRAINT \`${constraintName}\`
      FOREIGN KEY (\`${columnName}\`)
      REFERENCES \`${referencedTableName}\`(\`${referencedColumnName}\`)
      ON UPDATE ${onUpdate}
      ON DELETE ${onDelete}
    `,
    { transaction },
  );
  return true;
};

const dropIndexIfExists = async (tableName, indexName, transaction) => {
  const schemaName = await getCurrentSchema(transaction);
  const indexMap = await getIndexMeta(tableName, schemaName, transaction);
  if (!indexNameExists(indexMap, indexName)) return false;
  await db.sequelize.query(
    `ALTER TABLE \`${tableName}\` DROP INDEX \`${indexName}\``,
    { transaction },
  );
  return true;
};

const dropFkIfExists = async (tableName, constraintName, transaction) => {
  const schemaName = await getCurrentSchema(transaction);
  const fkRows = await getFkMeta(tableName, schemaName, transaction);
  if (!fkNameExists(fkRows, constraintName)) return false;
  await db.sequelize.query(
    `ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${constraintName}\``,
    { transaction },
  );
  return true;
};

const ensureAll = async (transaction) => {
  // navigation_items indexes
  await ensureIndex(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_sidebar_section",
    ["sidebar_section_id"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_sidebar_section_sort",
    ["sidebar_section_id", "sort_order"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_tenant_section_sort",
    ["tenant_id", "sidebar_section_id", "sort_order"],
    {},
    transaction,
  );

  // sidebar_section_industries indexes
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "idx_ssi_section",
    ["sidebar_section_id"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "idx_ssi_industry",
    ["industry_id"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "idx_ssi_active",
    ["is_active"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "uq_ssi_section_industry",
    ["sidebar_section_id", "industry_id"],
    { unique: true },
    transaction,
  );

  // sidebar_section_plans indexes
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_PLANS,
    "idx_ssp_section",
    ["sidebar_section_id"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_PLANS,
    "idx_ssp_plan",
    ["plan_id"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_PLANS,
    "idx_ssp_active",
    ["is_active"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_PLANS,
    "uq_ssp_section_plan",
    ["sidebar_section_id", "plan_id"],
    { unique: true },
    transaction,
  );

  // sidebar_section_tenants indexes
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "idx_sst_section",
    ["sidebar_section_id"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "idx_sst_tenant",
    ["tenant_id"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "idx_sst_active",
    ["is_active"],
    {},
    transaction,
  );
  await ensureIndex(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "uq_sst_section_tenant",
    ["sidebar_section_id", "tenant_id"],
    { unique: true },
    transaction,
  );

  // FKs
  await ensureForeignKey(
    tableNames.NAVIGATION_ITEMS,
    {
      constraintName: "fk_ensure_navigation_items_sidebar_section",
      columnName: "sidebar_section_id",
      referencedTableName: tableNames.SIDEBAR_SECTIONS,
      referencedColumnName: "sidebar_section_id",
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    transaction,
  );

  await ensureForeignKey(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    {
      constraintName: "fk_ensure_ssi_sidebar_section",
      columnName: "sidebar_section_id",
      referencedTableName: tableNames.SIDEBAR_SECTIONS,
      referencedColumnName: "sidebar_section_id",
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    transaction,
  );
  await ensureForeignKey(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    {
      constraintName: "fk_ensure_ssi_industry",
      columnName: "industry_id",
      referencedTableName: tableNames.INDUSTRIES,
      referencedColumnName: "industry_id",
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    transaction,
  );

  await ensureForeignKey(
    tableNames.SIDEBAR_SECTION_PLANS,
    {
      constraintName: "fk_ensure_ssp_sidebar_section",
      columnName: "sidebar_section_id",
      referencedTableName: tableNames.SIDEBAR_SECTIONS,
      referencedColumnName: "sidebar_section_id",
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    transaction,
  );
  await ensureForeignKey(
    tableNames.SIDEBAR_SECTION_PLANS,
    {
      constraintName: "fk_ensure_ssp_plan",
      columnName: "plan_id",
      referencedTableName: tableNames.PLANS,
      referencedColumnName: "plan_id",
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    transaction,
  );

  await ensureForeignKey(
    tableNames.SIDEBAR_SECTION_TENANTS,
    {
      constraintName: "fk_ensure_sst_sidebar_section",
      columnName: "sidebar_section_id",
      referencedTableName: tableNames.SIDEBAR_SECTIONS,
      referencedColumnName: "sidebar_section_id",
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    transaction,
  );
  await ensureForeignKey(
    tableNames.SIDEBAR_SECTION_TENANTS,
    {
      constraintName: "fk_ensure_sst_tenant",
      columnName: "tenant_id",
      referencedTableName: tableNames.TENANTS,
      referencedColumnName: "tenant_id",
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    transaction,
  );
};

const rollbackEnsure = async (transaction) => {
  // Drop ensure FKs only (safe, additive rollback)
  await dropFkIfExists(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "fk_ensure_sst_tenant",
    transaction,
  );
  await dropFkIfExists(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "fk_ensure_sst_sidebar_section",
    transaction,
  );
  await dropFkIfExists(
    tableNames.SIDEBAR_SECTION_PLANS,
    "fk_ensure_ssp_plan",
    transaction,
  );
  await dropFkIfExists(
    tableNames.SIDEBAR_SECTION_PLANS,
    "fk_ensure_ssp_sidebar_section",
    transaction,
  );
  await dropFkIfExists(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "fk_ensure_ssi_industry",
    transaction,
  );
  await dropFkIfExists(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "fk_ensure_ssi_sidebar_section",
    transaction,
  );
  await dropFkIfExists(
    tableNames.NAVIGATION_ITEMS,
    "fk_ensure_navigation_items_sidebar_section",
    transaction,
  );

  // Drop ensure indexes only (do not touch pre-existing differently named ones)
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "uq_sst_section_tenant",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "idx_sst_active",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "idx_sst_tenant",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_TENANTS,
    "idx_sst_section",
    transaction,
  );

  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_PLANS,
    "uq_ssp_section_plan",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_PLANS,
    "idx_ssp_active",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_PLANS,
    "idx_ssp_plan",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_PLANS,
    "idx_ssp_section",
    transaction,
  );

  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "uq_ssi_section_industry",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "idx_ssi_active",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "idx_ssi_industry",
    transaction,
  );
  await dropIndexIfExists(
    tableNames.SIDEBAR_SECTION_INDUSTRIES,
    "idx_ssi_section",
    transaction,
  );

  await dropIndexIfExists(
    tableNames.NAVIGATION_ITEMS,
    "idx_navigation_items_tenant_section_sort",
    transaction,
  );
};

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  
    
  } catch (err) {
    console.error("[MIGRATION] FAILED:", err.message);
    process.exit(1);
  } finally {
    await db.sequelize.close();
  }
};

run();
