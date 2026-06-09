import OpenAI from "openai";
import { getSecret } from "../../models/TenantSecretsModel/tenantSecrets.service.js";
import db from "../../database/index.js";
import { decrypt } from "../encryption.js";

// Cache resolved tenant keys for 5 minutes to avoid repeated DB + decrypt round-trips.
// We cache a boolean flag (not the raw key) to detect cache misses cleanly.
const tenantKeyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Returns an OpenAI client configured with the tenant's decrypted API key.
 * Lookup order:
 *   1. In-memory cache (5 min TTL)
 *   2. tenant_secrets table (AES-256-GCM, per-tenant derived key)
 *   3. ai_settings JSON column — legacy CBC fallback for tenants not yet migrated
 *   4. Global OPENAI_API_KEY env var
 *
 * The raw key is never stored in cache or logs.
 */
export const getOpenAIClient = async (tenant_id = null) => {
  let apiKey = process.env.OPENAI_API_KEY;

  if (tenant_id) {
    const now = Date.now();
    const cached = tenantKeyCache.get(tenant_id);

    if (cached && now - cached.timestamp < CACHE_TTL) {
      if (cached.key) apiKey = cached.key;
    } else {
      let resolvedKey = null;
      try {
        // 1. Try tenant_secrets (GCM)
        resolvedKey = await getSecret(tenant_id, "openai");

        // 2. Legacy fallback — CBC key still in ai_settings JSON
        if (!resolvedKey) {
          const tenant = await db.Tenants.findOne({
            where: { tenant_id, is_deleted: false },
            attributes: ["ai_settings"],
            raw: true,
          });
          if (tenant?.ai_settings) {
            const settings =
              typeof tenant.ai_settings === "string"
                ? JSON.parse(tenant.ai_settings)
                : tenant.ai_settings;
            if (settings.openai_api_key) {
              resolvedKey = decrypt(settings.openai_api_key);
            }
          }
        }
      } catch (err) {
        console.error("[getOpenAIClient] Failed to resolve tenant API key:", err.message);
      }

      if (resolvedKey) apiKey = resolvedKey;

      tenantKeyCache.set(tenant_id, {
        key: resolvedKey || null,
        timestamp: now,
      });
    }
  }

  return new OpenAI({ apiKey });
};
