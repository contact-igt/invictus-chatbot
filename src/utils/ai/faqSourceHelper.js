import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

/**
 * FAQ Source Helper
 *
 * Enforces the single FAQ master source rule per tenant.
 * Each tenant may have exactly ONE knowledge_source of type='faq',
 * titled "Doctor FAQ Knowledge".
 *
 * All published FAQ entries are logically grouped under this one source.
 * Never create a new knowledge_source per FAQ row.
 */

const FAQ_MASTER_TITLE = "Doctor FAQ Knowledge";
const FAQ_MASTER_TYPE = "faq";
const FAQ_TITLE_NORMALIZED = FAQ_MASTER_TITLE.toLowerCase();

const buildInClause = (items = []) => items.map(() => "?").join(", ");

const getFaqSourceCandidates = async (tenantId, transaction = null) => {
  const [rows] = await db.sequelize.query(
    `SELECT *
     FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE tenant_id = ?
       AND is_deleted = false
       AND (
         type = ?
         OR LOWER(TRIM(title)) = ?
       )
     ORDER BY
       CASE WHEN type = ? THEN 0 ELSE 1 END,
       CASE WHEN status = 'active' THEN 0 ELSE 1 END,
       id ASC`,
    {
      replacements: [
        tenantId,
        FAQ_MASTER_TYPE,
        FAQ_TITLE_NORMALIZED,
        FAQ_MASTER_TYPE,
      ],
      transaction,
    },
  );

  return rows;
};

const createFaqMasterSource = async (tenantId, transaction = null) => {
  await db.sequelize.query(
    `INSERT INTO ${tableNames.KNOWLEDGESOURCE}
       (tenant_id, title, type, raw_text, status, is_deleted, created_at, updated_at)
     VALUES (?, ?, ?, '', 'active', false, NOW(), NOW())`,
    { replacements: [tenantId, FAQ_MASTER_TITLE, FAQ_MASTER_TYPE], transaction },
  );

  const [rows] = await db.sequelize.query(
    `SELECT *
     FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE tenant_id = ? AND type = ? AND is_deleted = false
     ORDER BY id DESC
     LIMIT 1`,
    { replacements: [tenantId, FAQ_MASTER_TYPE], transaction },
  );

  return rows[0] || null;
};

const normalizeFaqSourceRow = async (
  source,
  tenantId,
  transaction = null,
) => {
  if (!source) return null;

  const currentTitle = String(source.title || "").trim();
  const shouldNormalize =
    source.type !== FAQ_MASTER_TYPE ||
    currentTitle !== FAQ_MASTER_TITLE ||
    source.is_deleted;

  if (!shouldNormalize) return source;

  await db.sequelize.query(
    `UPDATE ${tableNames.KNOWLEDGESOURCE}
     SET title = ?,
         type = ?,
         is_deleted = false,
         deleted_at = NULL,
         updated_at = NOW()
     WHERE id = ? AND tenant_id = ?`,
    {
      replacements: [FAQ_MASTER_TITLE, FAQ_MASTER_TYPE, source.id, tenantId],
      transaction,
    },
  );

  const [rows] = await db.sequelize.query(
    `SELECT *
     FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE id = ? AND tenant_id = ?
     LIMIT 1`,
    { replacements: [source.id, tenantId], transaction },
  );

  return rows[0] || source;
};

const mergeDuplicateFaqSources = async (
  tenantId,
  canonicalSourceId,
  duplicateIds = [],
  transaction = null,
) => {
  if (!duplicateIds.length) return;

  const inClause = buildInClause(duplicateIds);

  await db.sequelize.query(
    `UPDATE ${tableNames.FAQ_KNOWLEDGE_SOURCE}
     SET source_id = ?, updated_at = NOW()
     WHERE tenant_id = ?
       AND source_id IN (${inClause})`,
    {
      replacements: [canonicalSourceId, tenantId, ...duplicateIds],
      transaction,
    },
  );

  await db.sequelize.query(
    `UPDATE ${tableNames.KNOWLEDGESOURCE}
     SET status = 'inactive',
         is_deleted = true,
         deleted_at = NOW(),
         updated_at = NOW()
     WHERE tenant_id = ?
       AND id IN (${inClause})`,
    { replacements: [tenantId, ...duplicateIds], transaction },
  );
};

/**
 * Returns the existing FAQ master source, or creates it if missing.
 * Safe to call on every publish — idempotent.
 */
export const ensureFaqMasterSource = async (tenantId) => {
  const transaction = await db.sequelize.transaction();

  try {
    let candidates = await getFaqSourceCandidates(tenantId, transaction);
    let canonical = candidates[0] || null;

    if (!canonical) {
      canonical = await createFaqMasterSource(tenantId, transaction);
    }

    canonical = await normalizeFaqSourceRow(canonical, tenantId, transaction);

    candidates = await getFaqSourceCandidates(tenantId, transaction);
    const duplicateIds = candidates
      .filter((row) => Number(row.id) !== Number(canonical.id))
      .map((row) => Number(row.id));

    await mergeDuplicateFaqSources(
      tenantId,
      canonical.id,
      duplicateIds,
      transaction,
    );

    await transaction.commit();
    return canonical;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

export const ensureFaqMasterSourceInTransaction = async (
  tenantId,
  transaction,
) => {
  if (!transaction) return ensureFaqMasterSource(tenantId);

  let candidates = await getFaqSourceCandidates(tenantId, transaction);
  let canonical = candidates[0] || null;

  if (!canonical) {
    canonical = await createFaqMasterSource(tenantId, transaction);
  }

  canonical = await normalizeFaqSourceRow(canonical, tenantId, transaction);

  candidates = await getFaqSourceCandidates(tenantId, transaction);
  const duplicateIds = candidates
    .filter((row) => Number(row.id) !== Number(canonical.id))
    .map((row) => Number(row.id));

  await mergeDuplicateFaqSources(
    tenantId,
    canonical.id,
    duplicateIds,
    transaction,
  );

  return canonical;
};

/**
 * Returns the FAQ master source row for the tenant, or null if none exists.
 */
export const getFaqMasterSource = async (tenantId) => {
  const [rows] = await db.sequelize.query(
    `SELECT *
     FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE tenant_id = ? AND type = ? AND is_deleted = false
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    { replacements: [tenantId, FAQ_MASTER_TYPE] },
  );
  return rows[0] || null;
};

/**
 * Returns true if the FAQ master source exists AND is status='active'.
 * Retrieval should exclude FAQ entries when this returns false.
 */
export const isFaqMasterSourceActive = async (tenantId) => {
  const [rows] = await db.sequelize.query(
    `SELECT status FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE tenant_id = ? AND type = ? AND is_deleted = false
     ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id ASC
     LIMIT 1`,
    { replacements: [tenantId, FAQ_MASTER_TYPE] },
  );
  return rows[0]?.status === "active";
};
