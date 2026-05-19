import db from "../database/index.js";
import {
  FEATURE_METADATA,
  INDUSTRY_TYPES,
  getDefaultFeaturesForIndustry,
} from "../config/featureAccess.config.js";

const SOURCE_TAG = "featureAccess.config.js";
const DEFAULT_PLAN_ID = "default_plan";
const DEFAULT_PLAN_KEY = "default";
const DEFAULT_PLAN_NAME = "Default Plan";
const ALWAYS_ENABLED_MODULE_KEYS = new Set([
  "followups",
  "whatsapp_settings",
  "whatsapp_playground",
]);

const EXTRA_FEATURE_SEEDS = [
  {
    key: "followups",
    label: "Follow-up Hub",
    category: "common",
    group: "Contacts & Leads",
    route: "/followups",
    isCommon: true,
    allowedIndustries: [...INDUSTRY_TYPES],
  },
  {
    key: "whatsapp_settings",
    label: "WhatsApp Settings",
    category: "common",
    group: "Settings",
    route: "/settings/whatsapp-settings",
    isCommon: true,
    allowedIndustries: [...INDUSTRY_TYPES],
  },
  {
    key: "whatsapp_playground",
    label: "WhatsApp Playground",
    category: "common",
    group: "Settings",
    route: "/settings/whatsapp-playground",
    isCommon: true,
    allowedIndustries: [...INDUSTRY_TYPES],
  },
];

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes("--dry-run");
const SHOULD_MIGRATE_OVERRIDES = args.includes("--migrate-overrides");

const counters = {
  industries: { created: 0, updated: 0, skipped: 0 },
  modules: { created: 0, updated: 0, skipped: 0 },
  industryMappings: { created: 0, updated: 0, skipped: 0 },
  plans: { created: 0, updated: 0, skipped: 0 },
  planMappings: { created: 0, updated: 0, skipped: 0 },
  navigationItems: { created: 0, updated: 0, skipped: 0 },
  tenants: { backfilled: 0, skipped: 0 },
  overrides: {
    created: 0,
    updated: 0,
    skipped: 0,
    unknownFeatureKeys: new Set(),
    notRequested: !SHOULD_MIGRATE_OVERRIDES,
  },
};

const industryTitle = (key) => key.charAt(0).toUpperCase() + key.slice(1);

const asObject = (value) => {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
};

const isSeedOwned = (metadata) => {
  const parsed = asObject(metadata);
  return parsed?.seeded_from === SOURCE_TAG;
};

const mergedSeedMetadata = (metadata, extra = {}) => ({
  ...(asObject(metadata) || {}),
  ...extra,
  seeded_from: SOURCE_TAG,
});

const toBooleanLike = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) {
    return Boolean(value);
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "1") return true;
    if (lowered === "false" || lowered === "0") return false;
  }
  return null;
};

const toNumberLike = (value) => {
  if (typeof value === "number") return Number(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  }
  return null;
};

const stableStringify = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const areEquivalent = (left, right) => {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (right === null || right === undefined) return false;

  const leftBool = toBooleanLike(left);
  const rightBool = toBooleanLike(right);
  if (leftBool !== null && rightBool !== null) {
    return leftBool === rightBool;
  }

  const leftNum = toNumberLike(left);
  const rightNum = toNumberLike(right);
  if (leftNum !== null && rightNum !== null) {
    return leftNum === rightNum;
  }

  const leftObj = asObject(left);
  const rightObj = asObject(right);
  if (leftObj && rightObj) {
    return stableStringify(leftObj) === stableStringify(rightObj);
  }

  if (typeof left === "string" && typeof right === "string") {
    return left.trim() === right.trim();
  }

  return left === right;
};

const hasDiff = (current, desired, fields) =>
  fields.some((field) => !areEquivalent(current?.[field], desired?.[field]));

const logAction = (msg) => {
  const prefix = IS_DRY_RUN ? "[DRY-RUN]" : "[APPLY]";
  console.log(`${prefix} ${msg}`);
};

const maybeCreate = async (model, payload, counterBucket, label) => {
  if (IS_DRY_RUN) {
    counterBucket.created += 1;
    logAction(`Create ${label}`);
    return;
  }
  await model.create(payload);
  counterBucket.created += 1;
};

const maybeUpdate = async (model, payload, where, counterBucket, label) => {
  if (IS_DRY_RUN) {
    counterBucket.updated += 1;
    logAction(`Update ${label}`);
    return;
  }
  await model.update(payload, { where });
  counterBucket.updated += 1;
};

const mapIndustryTypeToIndustryId = (industryType) => {
  if (industryType === "healthcare") return "healthcare";
  if (industryType === "education") return "education";
  if (industryType === "general") return "general";
  return "general";
};

const getSeedFeatures = () => {
  const byKey = new Map(FEATURE_METADATA.map((feature) => [feature.key, feature]));
  for (const feature of EXTRA_FEATURE_SEEDS) {
    if (!byKey.has(feature.key)) {
      byKey.set(feature.key, feature);
    }
  }
  return Array.from(byKey.values());
};

const buildModuleSeeds = () =>
  getSeedFeatures().map((feature, index) => ({
    feature_key: feature.key,
    module_id: `mod_${feature.key}`,
    module_key: feature.key,
    module_name: feature.label,
    description: null,
    category: feature.category || "common",
    route_path: feature.route || null,
    module_type: "feature",
    visibility_type: "sidebar",
    is_system_core: false,
    is_active: true,
    sort_order: index,
    metadata: {
      group: feature.group || "Common",
      is_common: Boolean(feature.isCommon),
      allowed_industries: Array.isArray(feature.allowedIndustries)
        ? feature.allowedIndustries
        : [...INDUSTRY_TYPES],
      seeded_from: SOURCE_TAG,
    },
  }));

const buildIndustrySeeds = () =>
  ["general", "healthcare", "education"].map((industryKey) => ({
    industry_id: industryKey,
    industry_key: industryKey,
    industry_name: industryTitle(industryKey),
    is_active: true,
    metadata: { seeded_from: SOURCE_TAG },
  }));

const buildNavigationSeeds = () =>
  getSeedFeatures().map((feature, index) => ({
    navigation_item_id: `nav_${feature.key}`,
    tenant_id: null,
    module_id: `mod_${feature.key}`,
    label: feature.label,
    route_path: feature.route || null,
    icon_key: null,
    parent_item_id: null,
    menu_group: feature.group || "Common",
    is_visible: true,
    sort_order: index,
    is_active: true,
    metadata: { seeded_from: SOURCE_TAG },
  }));

const upsertIndustries = async (industrySeeds) => {
  const existingRows = await db.Industries.findAll({ raw: true });
  const byId = new Map(existingRows.map((row) => [row.industry_id, row]));
  const byKey = new Map(existingRows.map((row) => [row.industry_key, row]));

  for (const seed of industrySeeds) {
    const existing = byId.get(seed.industry_id);
    if (!existing) {
      const keyCollision = byKey.get(seed.industry_key);
      if (keyCollision) {
        counters.industries.skipped += 1;
        logAction(
          `Skip industry ${seed.industry_id} due to industry_key collision (${seed.industry_key})`,
        );
        continue;
      }

      await maybeCreate(db.Industries, seed, counters.industries, `industry ${seed.industry_id}`);
      continue;
    }

    if (!isSeedOwned(existing.metadata)) {
      counters.industries.skipped += 1;
      continue;
    }

    const updatePayload = {
      industry_key: seed.industry_key,
      industry_name: seed.industry_name,
      is_active: seed.is_active,
      metadata: mergedSeedMetadata(existing.metadata),
    };

    if (!hasDiff(existing, updatePayload, ["industry_key", "industry_name", "is_active", "metadata"])) {
      counters.industries.skipped += 1;
      continue;
    }

    await maybeUpdate(
      db.Industries,
      updatePayload,
      { industry_id: seed.industry_id },
      counters.industries,
      `industry ${seed.industry_id}`,
    );
  }
};

const upsertModules = async (moduleSeeds) => {
  const existingRows = await db.SaaSModules.findAll({ raw: true });
  const byId = new Map(existingRows.map((row) => [row.module_id, row]));
  const byKey = new Map(existingRows.map((row) => [row.module_key, row]));

  for (const seed of moduleSeeds) {
    const existing = byId.get(seed.module_id);
    if (!existing) {
      const keyCollision = byKey.get(seed.module_key);
      if (keyCollision) {
        counters.modules.skipped += 1;
        logAction(
          `Skip module ${seed.module_id} due to module_key collision (${seed.module_key})`,
        );
        continue;
      }

      await maybeCreate(db.SaaSModules, seed, counters.modules, `module ${seed.module_id}`);
      continue;
    }

    if (!isSeedOwned(existing.metadata)) {
      counters.modules.skipped += 1;
      continue;
    }

    const updatePayload = {
      module_key: seed.module_key,
      module_name: seed.module_name,
      description: seed.description,
      category: seed.category,
      route_path: seed.route_path,
      module_type: seed.module_type,
      visibility_type: seed.visibility_type,
      is_system_core: seed.is_system_core,
      is_active: seed.is_active,
      sort_order: seed.sort_order,
      metadata: mergedSeedMetadata(existing.metadata, {
        group: seed.metadata.group,
        is_common: seed.metadata.is_common,
        allowed_industries: seed.metadata.allowed_industries,
      }),
    };

    if (
      !hasDiff(existing, updatePayload, [
        "module_key",
        "module_name",
        "description",
        "category",
        "route_path",
        "module_type",
        "visibility_type",
        "is_system_core",
        "is_active",
        "sort_order",
        "metadata",
      ])
    ) {
      counters.modules.skipped += 1;
      continue;
    }

    await maybeUpdate(
      db.SaaSModules,
      updatePayload,
      { module_id: seed.module_id },
      counters.modules,
      `module ${seed.module_id}`,
    );
  }
};

const upsertIndustryMappings = async (industrySeeds, moduleSeeds) => {
  const existingRows = await db.IndustrySaaSModules.findAll({ raw: true });
  const byCompositeKey = new Map(
    existingRows.map((row) => [`${row.industry_id}|${row.module_id}`, row]),
  );

  for (const industry of industrySeeds) {
    const defaults = new Set(getDefaultFeaturesForIndustry(industry.industry_id));

    for (const module of moduleSeeds) {
      const key = `${industry.industry_id}|${module.module_id}`;
      const existing = byCompositeKey.get(key);
      const desiredPayload = {
        industry_id: industry.industry_id,
        module_id: module.module_id,
        is_enabled:
          defaults.has(module.module_key) ||
          ALWAYS_ENABLED_MODULE_KEYS.has(module.module_key),
        metadata: { seeded_from: SOURCE_TAG },
      };

      if (!existing) {
        await maybeCreate(
          db.IndustrySaaSModules,
          desiredPayload,
          counters.industryMappings,
          `industry mapping ${key}`,
        );
        continue;
      }

      if (!isSeedOwned(existing.metadata)) {
        counters.industryMappings.skipped += 1;
        continue;
      }

      const updatePayload = {
        is_enabled: desiredPayload.is_enabled,
        metadata: mergedSeedMetadata(existing.metadata),
      };

      if (!hasDiff(existing, updatePayload, ["is_enabled", "metadata"])) {
        counters.industryMappings.skipped += 1;
        continue;
      }

      await maybeUpdate(
        db.IndustrySaaSModules,
        updatePayload,
        { industry_id: industry.industry_id, module_id: module.module_id },
        counters.industryMappings,
        `industry mapping ${key}`,
      );
    }
  }
};

const upsertDefaultPlan = async () => {
  const seed = {
    plan_id: DEFAULT_PLAN_ID,
    plan_key: DEFAULT_PLAN_KEY,
    plan_name: DEFAULT_PLAN_NAME,
    description: null,
    price: 0,
    billing_cycle: "custom",
    sort_order: 0,
    is_active: true,
    metadata: { seeded_from: SOURCE_TAG },
  };

  const existingRows = await db.Plans.findAll({ raw: true });
  const existingById = new Map(existingRows.map((row) => [row.plan_id, row]));
  const existingByKey = new Map(existingRows.map((row) => [row.plan_key, row]));

  const existing = existingById.get(seed.plan_id);

  if (!existing) {
    const keyCollision = existingByKey.get(seed.plan_key);
    if (keyCollision) {
      counters.plans.skipped += 1;
      logAction(
        `Skip plan ${seed.plan_id} due to plan_key collision (${seed.plan_key})`,
      );
      return;
    }
    await maybeCreate(db.Plans, seed, counters.plans, `plan ${seed.plan_id}`);
    return;
  }

  if (!isSeedOwned(existing.metadata)) {
    counters.plans.skipped += 1;
    return;
  }

  const updatePayload = {
    plan_key: seed.plan_key,
    plan_name: seed.plan_name,
    description: seed.description,
    price: seed.price,
    billing_cycle: seed.billing_cycle,
    sort_order: seed.sort_order,
    is_active: seed.is_active,
    metadata: mergedSeedMetadata(existing.metadata),
  };

  if (
    !hasDiff(existing, updatePayload, [
      "plan_key",
      "plan_name",
      "description",
      "price",
      "billing_cycle",
      "sort_order",
      "is_active",
      "metadata",
    ])
  ) {
    counters.plans.skipped += 1;
    return;
  }

  await maybeUpdate(
    db.Plans,
    updatePayload,
    { plan_id: seed.plan_id },
    counters.plans,
    `plan ${seed.plan_id}`,
  );
};

const upsertPlanMappings = async (moduleSeeds) => {
  const existingRows = await db.PlanSaaSModules.findAll({ raw: true });
  const byCompositeKey = new Map(
    existingRows.map((row) => [`${row.plan_id}|${row.module_id}`, row]),
  );

  for (const module of moduleSeeds) {
    const key = `${DEFAULT_PLAN_ID}|${module.module_id}`;
    const existing = byCompositeKey.get(key);
    const desiredPayload = {
      plan_id: DEFAULT_PLAN_ID,
      module_id: module.module_id,
      is_enabled: true,
      metadata: { seeded_from: SOURCE_TAG },
    };

    if (!existing) {
      await maybeCreate(
        db.PlanSaaSModules,
        desiredPayload,
        counters.planMappings,
        `plan mapping ${key}`,
      );
      continue;
    }

    if (!isSeedOwned(existing.metadata)) {
      counters.planMappings.skipped += 1;
      continue;
    }

    const updatePayload = {
      is_enabled: true,
      metadata: mergedSeedMetadata(existing.metadata),
    };

    if (!hasDiff(existing, updatePayload, ["is_enabled", "metadata"])) {
      counters.planMappings.skipped += 1;
      continue;
    }

    await maybeUpdate(
      db.PlanSaaSModules,
      updatePayload,
      { plan_id: DEFAULT_PLAN_ID, module_id: module.module_id },
      counters.planMappings,
      `plan mapping ${key}`,
    );
  }
};

const upsertNavigationItems = async (navigationSeeds) => {
  const existingRows = await db.NavigationItems.findAll({ raw: true });
  const byId = new Map(existingRows.map((row) => [row.navigation_item_id, row]));

  for (const seed of navigationSeeds) {
    const existing = byId.get(seed.navigation_item_id);
    if (!existing) {
      await maybeCreate(
        db.NavigationItems,
        seed,
        counters.navigationItems,
        `navigation item ${seed.navigation_item_id}`,
      );
      continue;
    }

    if (!isSeedOwned(existing.metadata)) {
      counters.navigationItems.skipped += 1;
      continue;
    }

    const updatePayload = {
      tenant_id: null,
      module_id: seed.module_id,
      label: seed.label,
      route_path: seed.route_path,
      icon_key: null,
      parent_item_id: null,
      menu_group: seed.menu_group,
      is_visible: true,
      sort_order: seed.sort_order,
      is_active: true,
      metadata: mergedSeedMetadata(existing.metadata),
    };

    if (
      !hasDiff(existing, updatePayload, [
        "tenant_id",
        "module_id",
        "label",
        "route_path",
        "icon_key",
        "parent_item_id",
        "menu_group",
        "is_visible",
        "sort_order",
        "is_active",
        "metadata",
      ])
    ) {
      counters.navigationItems.skipped += 1;
      continue;
    }

    await maybeUpdate(
      db.NavigationItems,
      updatePayload,
      { navigation_item_id: seed.navigation_item_id },
      counters.navigationItems,
      `navigation item ${seed.navigation_item_id}`,
    );
  }
};

const backfillTenants = async () => {
  const tenants = await db.Tenants.findAll({
    where: { is_deleted: false },
    attributes: ["tenant_id", "industry_type", "industry_id", "plan_id"],
    raw: true,
  });

  for (const tenant of tenants) {
    const updates = {};

    if (tenant.industry_id === null || tenant.industry_id === undefined) {
      updates.industry_id = mapIndustryTypeToIndustryId(tenant.industry_type);
    }

    if (tenant.plan_id === null || tenant.plan_id === undefined) {
      updates.plan_id = DEFAULT_PLAN_ID;
    }

    if (Object.keys(updates).length === 0) {
      counters.tenants.skipped += 1;
      continue;
    }

    if (IS_DRY_RUN) {
      counters.tenants.backfilled += 1;
      logAction(
        `Backfill tenant ${tenant.tenant_id} -> ${JSON.stringify(updates)}`,
      );
      continue;
    }

    await db.Tenants.update(updates, { where: { tenant_id: tenant.tenant_id } });
    counters.tenants.backfilled += 1;
  }
};

const migrateOldOverrides = async () => {
  if (!SHOULD_MIGRATE_OVERRIDES) return;

  const [legacyRows, activeTenants, modules, existingOverrides] = await Promise.all([
    db.TenantFeatureAccess.findAll({
      attributes: ["tenant_id", "feature_key", "is_enabled"],
      raw: true,
    }),
    db.Tenants.findAll({
      where: { is_deleted: false },
      attributes: ["tenant_id"],
      raw: true,
    }),
    db.SaaSModules.findAll({
      attributes: ["module_id", "module_key", "is_active", "is_system_core"],
      raw: true,
    }),
    db.TenantSaaSModuleOverrides.findAll({ raw: true }),
  ]);

  const tenantSet = new Set(activeTenants.map((t) => t.tenant_id));
  const moduleByKey = new Map(modules.map((m) => [m.module_key, m]));
  const overridesByComposite = new Map(
    existingOverrides.map((o) => [`${o.tenant_id}|${o.module_id}`, o]),
  );

  for (const row of legacyRows) {
    const featureKey = row.feature_key;
    const tenantId = row.tenant_id;

    if (!tenantSet.has(tenantId)) {
      counters.overrides.skipped += 1;
      continue;
    }

    const module = moduleByKey.get(featureKey);
    if (!module) {
      counters.overrides.unknownFeatureKeys.add(featureKey);
      counters.overrides.skipped += 1;
      continue;
    }

    if (!module.is_active) {
      counters.overrides.skipped += 1;
      continue;
    }

    if (Boolean(module.is_system_core) && row.is_enabled === false) {
      counters.overrides.skipped += 1;
      continue;
    }

    const composite = `${tenantId}|${module.module_id}`;
    const existing = overridesByComposite.get(composite);

    const desiredPayload = {
      tenant_id: tenantId,
      module_id: module.module_id,
      is_enabled: Boolean(row.is_enabled),
      metadata: {
        seeded_from: SOURCE_TAG,
        migrated_from: "tenant_feature_access",
      },
    };

    if (!existing) {
      if (IS_DRY_RUN) {
        counters.overrides.created += 1;
        logAction(`Create override ${composite}`);
      } else {
        await db.TenantSaaSModuleOverrides.create(desiredPayload);
        counters.overrides.created += 1;
      }
      continue;
    }

    if (!isSeedOwned(existing.metadata)) {
      counters.overrides.skipped += 1;
      continue;
    }

    const updatePayload = {
      is_enabled: desiredPayload.is_enabled,
      metadata: mergedSeedMetadata(existing.metadata, {
        migrated_from: "tenant_feature_access",
      }),
    };

    if (!hasDiff(existing, updatePayload, ["is_enabled", "metadata"])) {
      counters.overrides.skipped += 1;
      continue;
    }

    if (IS_DRY_RUN) {
      counters.overrides.updated += 1;
      logAction(`Update override ${composite}`);
    } else {
      await db.TenantSaaSModuleOverrides.update(updatePayload, {
        where: { tenant_id: tenantId, module_id: module.module_id },
      });
      counters.overrides.updated += 1;
    }
  }
};

const printSummary = () => {
  const overridesMigrated =
    counters.overrides.created + counters.overrides.updated;

  console.log("\n================ DYNAMIC SAAS ACCESS SEED SUMMARY ================");
  console.log(`dry_run: ${IS_DRY_RUN}`);
  console.log(`migrate_overrides: ${SHOULD_MIGRATE_OVERRIDES}`);
  console.log(
    `industries: created=${counters.industries.created}, updated=${counters.industries.updated}, skipped=${counters.industries.skipped}`,
  );
  console.log(
    `modules: created=${counters.modules.created}, updated=${counters.modules.updated}, skipped=${counters.modules.skipped}`,
  );
  console.log(
    `industry_mappings: created=${counters.industryMappings.created}, updated=${counters.industryMappings.updated}, skipped=${counters.industryMappings.skipped}`,
  );
  console.log(
    `plans: created=${counters.plans.created}, updated=${counters.plans.updated}, skipped=${counters.plans.skipped}`,
  );
  console.log(
    `plan_mappings: created=${counters.planMappings.created}, updated=${counters.planMappings.updated}, skipped=${counters.planMappings.skipped}`,
  );
  console.log(
    `navigation_items: created=${counters.navigationItems.created}, updated=${counters.navigationItems.updated}, skipped=${counters.navigationItems.skipped}`,
  );
  console.log(
    `tenants: backfilled=${counters.tenants.backfilled}, skipped=${counters.tenants.skipped}`,
  );
  console.log(
    `overrides: migrated=${overridesMigrated}, created=${counters.overrides.created}, updated=${counters.overrides.updated}, skipped=${counters.overrides.skipped}`,
  );
  console.log(
    `unknown_feature_keys: ${
      counters.overrides.unknownFeatureKeys.size
        ? Array.from(counters.overrides.unknownFeatureKeys).join(", ")
        : "(none)"
    }`,
  );
  console.log("==================================================================\n");
};

const run = async () => {
  const industrySeeds = buildIndustrySeeds();
  const moduleSeeds = buildModuleSeeds();
  const navigationSeeds = buildNavigationSeeds();

  console.log("Starting dynamic SaaS access seed/migration script...");
  console.log(`Mode: ${IS_DRY_RUN ? "DRY RUN (no DB writes)" : "APPLY"}`);
  console.log(`Override migration: ${SHOULD_MIGRATE_OVERRIDES ? "ON" : "OFF"}`);

  await db.sequelize.authenticate();

  await upsertIndustries(industrySeeds);
  await upsertModules(moduleSeeds);
  await upsertIndustryMappings(industrySeeds, moduleSeeds);
  await upsertDefaultPlan();
  await upsertPlanMappings(moduleSeeds);
  await upsertNavigationItems(navigationSeeds);
  await backfillTenants();
  await migrateOldOverrides();
};

(async () => {
  try {
    await run();
    printSummary();
    process.exitCode = 0;
  } catch (error) {
    console.error("\nFatal seed/migration error:", error?.message || error);
    process.exitCode = 1;
  } finally {
    try {
      await db.sequelize.close();
    } catch {
      // Best-effort close only.
    }
  }
})();
