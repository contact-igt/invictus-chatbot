import db from "../../database/index.js";
import {
  FEATURE_METADATA,
  getDefaultFeaturesForIndustry,
  isValidFeatureKey,
  isValidIndustryType,
  resolveTenantFeatureAccess,
} from "../../config/featureAccess.config.js";

const LEGACY_HEALTHCARE_TYPES = new Set(["hospital", "clinic"]);

const inferIndustryType = (tenant = {}) => {
  if (isValidIndustryType(tenant?.industry_type)) return tenant.industry_type;
  if (tenant?.type === "education") return "education";
  if (LEGACY_HEALTHCARE_TYPES.has(tenant?.type)) return "healthcare";
  return "general";
};

const getTenantOrThrow = async (tenant_id) => {
  const tenant = await db.Tenants.findOne({
    where: { tenant_id, is_deleted: false },
    attributes: ["tenant_id", "industry_type", "type"],
    raw: true,
  });

  if (!tenant) {
    const error = new Error("Tenant not found");
    error.statusCode = 404;
    throw error;
  }

  return tenant;
};

export const getTenantFeatureOverridesService = async (tenant_id) => {
  const rows = await db.TenantFeatureAccess.findAll({
    where: { tenant_id },
    attributes: ["feature_key", "is_enabled"],
    raw: true,
  });

  return rows.map((row) => ({
    feature_key: row.feature_key,
    is_enabled: Boolean(row.is_enabled),
  }));
};

export const getResolvedTenantFeaturesService = async (tenant_id) => {
  const tenant = await getTenantOrThrow(tenant_id);
  const industryType = inferIndustryType(tenant);
  const overrides = await getTenantFeatureOverridesService(tenant_id);

  const resolved = resolveTenantFeatureAccess(industryType, overrides);

  return {
    industry_type: resolved.industry_type,
    default_features: resolved.default_features,
    overrides,
    enabled_features: resolved.enabled_features,
    disabled_features: resolved.disabled_features,
    feature_metadata: FEATURE_METADATA,
  };
};

export const upsertTenantFeatureOverridesService = async (
  tenant_id,
  payload = {},
) => {
  const { industry_type, overrides } = payload;

  const tenant = await getTenantOrThrow(tenant_id);
  const nextIndustryType =
    industry_type !== undefined ? industry_type : inferIndustryType(tenant);

  if (!isValidIndustryType(nextIndustryType)) {
    const error = new Error(
      "Invalid industry_type. Allowed values: healthcare, education, general",
    );
    error.statusCode = 400;
    throw error;
  }

  if (overrides !== undefined && !Array.isArray(overrides)) {
    const error = new Error("overrides must be an array");
    error.statusCode = 400;
    throw error;
  }

  const defaultSet = new Set(getDefaultFeaturesForIndustry(nextIndustryType));
  const overrideSource =
    overrides !== undefined
      ? overrides
      : await getTenantFeatureOverridesService(tenant_id);

  const normalizedOverrides = [];
  const seenFeatureKeys = new Set();

  for (const item of overrideSource) {
    const featureKey = item?.feature_key;
    const isEnabled = item?.is_enabled;

    if (!isValidFeatureKey(featureKey)) {
      const error = new Error(`Invalid feature_key: ${featureKey}`);
      error.statusCode = 400;
      throw error;
    }

    if (typeof isEnabled !== "boolean") {
      const error = new Error(
        `Invalid is_enabled for feature_key: ${featureKey}. Expected boolean.`,
      );
      error.statusCode = 400;
      throw error;
    }

    if (seenFeatureKeys.has(featureKey)) continue;
    seenFeatureKeys.add(featureKey);

    const isDefaultEnabled = defaultSet.has(featureKey);
    if (isEnabled !== isDefaultEnabled) {
      normalizedOverrides.push({
        tenant_id,
        feature_key: featureKey,
        is_enabled: isEnabled,
      });
    }
  }

  await db.sequelize.transaction(async (transaction) => {
    if (industry_type !== undefined) {
      await db.Tenants.update(
        { industry_type: nextIndustryType },
        { where: { tenant_id }, transaction },
      );
    }

    await db.TenantFeatureAccess.destroy({
      where: { tenant_id },
      transaction,
    });

    if (normalizedOverrides.length) {
      await db.TenantFeatureAccess.bulkCreate(normalizedOverrides, {
        transaction,
      });
    }
  });

  return getResolvedTenantFeaturesService(tenant_id);
};
