import db from "../../database/index.js";
import { Op } from "sequelize";

const getTenantOrThrow = async (tenant_id) => {
  if (
    tenant_id === null ||
    tenant_id === undefined ||
    (typeof tenant_id === "string" && tenant_id.trim() === "")
  ) {
    const error = new Error("tenant_id is required");
    error.statusCode = 400;
    throw error;
  }

  const tenant = await db.Tenants.findOne({
    where: { tenant_id, is_deleted: false },
    attributes: ["tenant_id", "industry_id", "plan_id"],
    raw: true,
  });

  if (!tenant) {
    const error = new Error("Tenant not found");
    error.statusCode = 404;
    throw error;
  }

  return tenant;
};

const buildModuleAccessMap = ({
  modules,
  industryRows,
  planRows,
  overrideRows,
}) => {
  const modulesById = new Map(modules.map((module) => [module.module_id, module]));
  const industryAccessMap = new Map();
  const planAccessMap = new Map();
  const overrideMap = new Map();
  const appliedOverrides = [];
  const ignoredOverrides = [];

  for (const row of industryRows) {
    industryAccessMap.set(row.module_id, Boolean(row.is_enabled));
  }

  for (const row of planRows) {
    planAccessMap.set(row.module_id, Boolean(row.is_enabled));
  }

  for (const row of overrideRows) {
    if (!modulesById.has(row.module_id)) {
      ignoredOverrides.push({
        module_id: row.module_id,
        is_enabled: Boolean(row.is_enabled),
        reason: "module_not_found_or_inactive",
      });
      continue;
    }
    overrideMap.set(row.module_id, Boolean(row.is_enabled));
  }

  const enabledModules = [];
  const disabledModules = [];

  for (const module of modules) {
    const isCore = Boolean(module.is_system_core);
    const hasIndustryAccess = industryAccessMap.get(module.module_id) === true;
    const hasPlanAccess = planAccessMap.get(module.module_id) === true;

    let isEnabled = isCore ? true : hasIndustryAccess && hasPlanAccess;

    if (overrideMap.has(module.module_id)) {
      const overrideEnabled = overrideMap.get(module.module_id);

      // Core modules are always enabled; ignore disabling overrides.
      if (!isCore || overrideEnabled === true) {
        isEnabled = overrideEnabled;
        appliedOverrides.push({
          module_id: module.module_id,
          is_enabled: overrideEnabled,
        });
      } else {
        ignoredOverrides.push({
          module_id: module.module_id,
          is_enabled: overrideEnabled,
          reason: "system_core_module_cannot_be_disabled",
        });
      }
    }

    const normalizedModule = {
      module_id: module.module_id,
      module_key: module.module_key,
      module_name: module.module_name,
      description: module.description,
      category: module.category,
      parent_module_id: module.parent_module_id,
      route_path: module.route_path,
      icon_key: module.icon_key,
      module_type: module.module_type,
      visibility_type: module.visibility_type,
      is_system_core: isCore,
      is_active: Boolean(module.is_active),
      sort_order: module.sort_order,
      metadata: module.metadata,
    };

    if (isEnabled) {
      enabledModules.push(normalizedModule);
    } else {
      disabledModules.push(normalizedModule);
    }
  }

  return {
    enabledModules,
    disabledModules,
    appliedOverrides,
    ignoredOverrides,
  };
};

const normalizeModuleAccessResponse = ({
  tenant,
  enabledModules,
  disabledModules,
  appliedOverrides,
  ignoredOverrides,
  modules,
}) => {
  const moduleMetadata = modules.map((module) => ({
    module_id: module.module_id,
    module_key: module.module_key,
    module_name: module.module_name,
    category: module.category,
    route_path: module.route_path,
    icon_key: module.icon_key,
    module_type: module.module_type,
    visibility_type: module.visibility_type,
    is_system_core: Boolean(module.is_system_core),
    is_active: Boolean(module.is_active),
    sort_order: module.sort_order,
    metadata: module.metadata,
  }));

  return {
    tenant_id: tenant.tenant_id,
    industry_id: tenant.industry_id || null,
    plan_id: tenant.plan_id || null,
    enabled_modules: enabledModules,
    disabled_modules: disabledModules,
    overrides: appliedOverrides,
    ignored_overrides: ignoredOverrides,
    module_metadata: moduleMetadata,
    enabled_module_keys: enabledModules.map((module) => module.module_key),
    disabled_module_keys: disabledModules.map((module) => module.module_key),
  };
};

const groupNavigationItems = (items) => {
  const grouped = new Map();

  for (const item of items) {
    const menuGroup = item.menu_group || "General";
    if (!grouped.has(menuGroup)) grouped.set(menuGroup, []);
    grouped.get(menuGroup).push(item);
  }

  return Array.from(grouped.entries()).map(([menu_group, groupedItems]) => ({
    menu_group,
    items: groupedItems,
  }));
};

export const getTenantDynamicAccessService = async (tenant_id) => {
  const tenant = await getTenantOrThrow(tenant_id);

  const modules = await db.SaaSModules.findAll({
    where: { is_active: true },
    attributes: [
      "module_id",
      "module_key",
      "module_name",
      "description",
      "category",
      "parent_module_id",
      "route_path",
      "icon_key",
      "module_type",
      "visibility_type",
      "is_system_core",
      "is_active",
      "sort_order",
      "metadata",
    ],
    order: [
      ["sort_order", "ASC"],
      ["module_name", "ASC"],
    ],
    raw: true,
  });

  if (modules.length === 0) {
    return normalizeModuleAccessResponse({
      tenant,
      enabledModules: [],
      disabledModules: [],
      appliedOverrides: [],
      ignoredOverrides: [],
      modules: [],
    });
  }

  const [industryRows, planRows, overrideRows] = await Promise.all([
    tenant.industry_id
      ? db.IndustrySaaSModules.findAll({
          where: { industry_id: tenant.industry_id },
          attributes: ["module_id", "is_enabled"],
          raw: true,
        })
      : Promise.resolve([]),
    tenant.plan_id
      ? db.PlanSaaSModules.findAll({
          where: { plan_id: tenant.plan_id },
          attributes: ["module_id", "is_enabled"],
          raw: true,
        })
      : Promise.resolve([]),
    db.TenantSaaSModuleOverrides.findAll({
      where: { tenant_id },
      attributes: ["module_id", "is_enabled"],
      raw: true,
    }),
  ]);

  const { enabledModules, disabledModules, appliedOverrides, ignoredOverrides } =
    buildModuleAccessMap({
      modules,
      industryRows,
      planRows,
      overrideRows,
    });

  return normalizeModuleAccessResponse({
    tenant,
    enabledModules,
    disabledModules,
    appliedOverrides,
    ignoredOverrides,
    modules,
  });
};

export const getTenantDynamicNavigationService = async (tenant_id) => {
  const access = await getTenantDynamicAccessService(tenant_id);
  const enabledModuleIds = access.enabled_modules.map((module) => module.module_id);

  if (enabledModuleIds.length === 0) {
    return {
      tenant_id,
      navigation: [],
    };
  }

  const rows = await db.NavigationItems.findAll({
    where: {
      is_active: true,
      is_visible: true,
      module_id: { [Op.in]: enabledModuleIds },
      [Op.or]: [{ tenant_id: null }, { tenant_id }],
    },
    attributes: [
      "navigation_item_id",
      "tenant_id",
      "module_id",
      "label",
      "route_path",
      "icon_key",
      "parent_item_id",
      "menu_group",
      "sort_order",
      "metadata",
    ],
    order: [
      ["menu_group", "ASC"],
      ["sort_order", "ASC"],
      ["label", "ASC"],
    ],
    raw: true,
  });

  const deduped = new Map();
  for (const row of rows) {
    const identityKey = [
      row.module_id || "",
      row.route_path || "",
      row.parent_item_id || "",
      row.menu_group || "",
    ].join("|");

    const existing = deduped.get(identityKey);
    if (!existing) {
      deduped.set(identityKey, row);
      continue;
    }

    const isTenantSpecific = row.tenant_id === tenant_id;
    const existingIsTenantSpecific = existing.tenant_id === tenant_id;

    if (isTenantSpecific && !existingIsTenantSpecific) {
      deduped.set(identityKey, row);
    }
  }

  const normalizedItems = Array.from(deduped.values()).sort((a, b) => {
    const groupCmp = (a.menu_group || "").localeCompare(b.menu_group || "");
    if (groupCmp !== 0) return groupCmp;

    const orderCmp = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (orderCmp !== 0) return orderCmp;

    return (a.label || "").localeCompare(b.label || "");
  });

  return {
    tenant_id,
    navigation: groupNavigationItems(normalizedItems),
  };
};
