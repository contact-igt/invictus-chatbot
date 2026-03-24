import db from "../../database/index.js";

const DEFAULT_INPUT_MODEL = "gpt-4o-mini";
const DEFAULT_OUTPUT_MODEL = "gpt-4o";

// Cache active models for 5 minutes to avoid repeated DB queries
let activeModelsCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

const getActiveModels = async () => {
  const now = Date.now();
  if (activeModelsCache && now - cacheTimestamp < CACHE_TTL) {
    return activeModelsCache;
  }

  try {
    const models = await db.AiPricing.findAll({
      where: { is_active: true },
      attributes: ["model"],
      raw: true,
    });
    activeModelsCache = new Set(models.map((m) => m.model));
    cacheTimestamp = now;
    return activeModelsCache;
  } catch (err) {
    console.error(
      "[getTenantAiModel] Failed to fetch active models:",
      err.message,
    );
    return null;
  }
};

/**
 * Get the AI model a tenant has selected for a given purpose.
 * Falls back to defaults if the tenant has no selection or the selected model is inactive.
 *
 * @param {string} tenant_id - Tenant identifier
 * @param {"input"|"output"} type - "input" for classification/extraction, "output" for generation
 * @returns {Promise<string>} The model name to use
 */
export const getTenantAiModel = async (tenant_id, type = "output") => {
  const defaultModel =
    type === "input" ? DEFAULT_INPUT_MODEL : DEFAULT_OUTPUT_MODEL;

  if (!tenant_id) return defaultModel;

  try {
    const tenant = await db.Tenants.findOne({
      where: { tenant_id, is_deleted: false },
      attributes: ["ai_settings"],
      raw: true,
    });

    if (!tenant?.ai_settings) return defaultModel;

    const settings =
      typeof tenant.ai_settings === "string"
        ? JSON.parse(tenant.ai_settings)
        : tenant.ai_settings;

    const selectedModel =
      type === "input" ? settings.input_model : settings.output_model;

    if (!selectedModel) return defaultModel;

    // Validate that the selected model is still active
    const activeModels = await getActiveModels();
    if (activeModels && !activeModels.has(selectedModel)) {
      return defaultModel;
    }

    return selectedModel;
  } catch (err) {
    console.error("[getTenantAiModel] Error:", err.message);
    return defaultModel;
  }
};
