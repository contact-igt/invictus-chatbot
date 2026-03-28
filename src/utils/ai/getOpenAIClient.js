import OpenAI from "openai";
import db from "../../database/index.js";
import { decrypt } from "../encryption.js";

// Cache decrypted tenant API keys for 5 minutes
const tenantKeyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Returns an OpenAI client configured with the tenant's decrypted API key.
 * Falls back to the global OPENAI_API_KEY from environment only if no tenant key exists.
 *
 * @param {string|null} tenant_id - Tenant identifier
 * @returns {Promise<OpenAI>} Configured OpenAI client
 */
export const getOpenAIClient = async (tenant_id = null) => {
  let apiKey = process.env.OPENAI_API_KEY;

  if (tenant_id) {
    const now = Date.now();
    const cached = tenantKeyCache.get(tenant_id);

    if (cached && now - cached.timestamp < CACHE_TTL) {
      if (cached.key) apiKey = cached.key;
    } else {
      try {
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
            // Decrypt the stored encrypted key
            const decryptedKey = decrypt(settings.openai_api_key);
            if (decryptedKey) {
              apiKey = decryptedKey;
            }
          }
        }

        tenantKeyCache.set(tenant_id, {
          key: apiKey !== process.env.OPENAI_API_KEY ? apiKey : null,
          timestamp: now,
        });
      } catch (err) {
        console.error(
          "[getOpenAIClient] Failed to fetch/decrypt tenant API key:",
          err.message,
        );
      }
    }
  }

  return new OpenAI({ apiKey });
};
