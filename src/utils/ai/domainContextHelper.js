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

    