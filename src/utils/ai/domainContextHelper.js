import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";

/**
 * Domain Context Helper
 *
 * Builds a short ~150-word business context summary for a tenant by reading
 * existing SQL data — no new table required.
 *
 * Sources joined:
 *   1. tenants.company_name + tenants.type
 *   2. Active ai_prompt.prompt (first 500 chars of instructions)
 *   3. Top 5 active knowledge_sources titles (what topics this business covers)
 *
 * The summary is persisted in tenants.ai_settings.domain_summary so it is
 * built only once and reused on every subsequent classification call.
 *
 * Call invalidateDomainSummary() any time the KB sources or active prompt
 * changes so the cache is transparently rebuilt on next use.
 */

// ──────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Returns the domain summary for a tenant.
 * Reads from cache (ai_settings.domain_summary) or builds fresh if absent.
 */
export const getDomainSummary = async (tenantId) => {
  try {
    // 1. Try cache first
    const cached = await _readCachedSummary(tenantId);
    if (cached) return cached;

    // 2. Build from SQL
    const summary = await _buildSummary(tenantId);

    // 3. Persist back into ai_settings so next call is instant
    await _writeCachedSummary(tenantId, summary);

    return summary;
  } catch (err) {
    console.error("[DOMAIN-CONTEXT] getDomainSummary failed:", err.message);
    // Non-fatal — return a minimal fallback so classification still works
    return "A business that uses a WhatsApp assistant for customer support.";
  }
};

/**
 * Wipes the cached domain_summary from ai_settings.
 * Call this whenever the tenant's active prompt or knowledge sources change.
 */
export const invalidateDomainSummary = async (tenantId) => {
  try {
    const [tenant] = await db.sequelize.query(
      `SELECT ai_settings FROM ${tableNames.TENANTS} WHERE tenant_id = ? LIMIT 1`,
      { replacements: [tenantId] },
    );

    if (!tenant.length) return;

    let settings = {};
    try {
      settings =
        typeof tenant[0].ai_settings === "string"
          ? JSON.parse(tenant[0].ai_settings)
          : tenant[0].ai_settings || {};
    } catch (_) {}

    delete settings.domain_summary;

    await db.sequelize.query(
      `UPDATE ${tableNames.TENANTS} SET ai_settings = ? WHERE tenant_id = ?`,
      { replacements: [JSON.stringify(settings), tenantId] },
    );

    console.log(`[DOMAIN-CONTEXT] Cache invalidated for tenant ${tenantId}`);
  } catch (err) {
    console.error("[DOMAIN-CONTEXT] invalidateDomainSummary failed:", err.message);
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Private helpers
// ──────────────────────────────────────────────────────────────────────────

const _readCachedSummary = async (tenantId) => {
  const [rows] = await db.sequelize.query(
    `SELECT ai_settings FROM ${tableNames.TENANTS} WHERE tenant_id = ? LIMIT 1`,
    { replacements: [tenantId] },
  );
  if (!rows.length) return null;

  let settings = {};
  try {
    settings =
      typeof rows[0].ai_settings === "string"
        ? JSON.parse(rows[0].ai_settings)
        : rows[0].ai_settings || {};
  } catch (_) {}

  return settings.domain_summary || null;
};

const _buildSummary = async (tenantId) => {
  // Tenant identity
  const [tenantRows] = await db.sequelize.query(
    `SELECT company_name, type FROM ${tableNames.TENANTS} WHERE tenant_id = ? LIMIT 1`,
    { replacements: [tenantId] },
  );

  const companyName = tenantRows[0]?.company_name || "this business";
  const tenantType = tenantRows[0]?.type || "organization";

  // Active business instructions (first 500 chars)
  const [promptRows] = await db.sequelize.query(
    `SELECT prompt FROM ${tableNames.AIPROMPT}
     WHERE tenant_id = ? AND is_active = true AND is_deleted = false
     ORDER BY created_at DESC LIMIT 1`,
    { replacements: [tenantId] },
  );
  const promptSnippet = promptRows[0]?.prompt?.substring(0, 500)?.trim() || "";

  // Top 5 active knowledge source titles (what topics the business has documented)
  const [sourceRows] = await db.sequelize.query(
    `SELECT title FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE tenant_id = ? AND status = 'active' AND is_deleted = false
     ORDER BY created_at DESC LIMIT 5`,
    { replacements: [tenantId] },
  );
  const topicList = sourceRows.map((r) => r.title).join(", ");

  // Build compact summary
  const parts = [
    `${companyName} is a ${tenantType}.`,
  ];
  if (topicList) {
    parts.push(`Topics documented: ${topicList}.`);
  }
  if (promptSnippet) {
    parts.push(`Business context: ${promptSnippet}`);
  }

  return parts.join(" ");
};

const _writeCachedSummary = async (tenantId, summary) => {
  const [rows] = await db.sequelize.query(
    `SELECT ai_settings FROM ${tableNames.TENANTS} WHERE tenant_id = ? LIMIT 1`,
    { replacements: [tenantId] },
  );
  if (!rows.length) return;

  let settings = {};
  try {
    settings =
      typeof rows[0].ai_settings === "string"
        ? JSON.parse(rows[0].ai_settings)
        : rows[0].ai_settings || {};
  } catch (_) {}

  settings.domain_summary = summary;

  await db.sequelize.query(
    `UPDATE ${tableNames.TENANTS} SET ai_settings = ? WHERE tenant_id = ?`,
    { replacements: [JSON.stringify(settings), tenantId] },
  );
};
