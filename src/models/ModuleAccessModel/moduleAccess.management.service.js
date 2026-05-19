import db from "../../database/index.js";
import { Op } from "sequelize";
import { getTenantDynamicAccessService } from "./moduleAccess.service.js";

const MODULE_TYPE_ENUM = new Set([
  "core",
  "feature",
  "addon",
  "experimental",
  "enterprise",
]);
const VISIBILITY_TYPE_ENUM = new Set([
  "sidebar",
  "hidden",
  "internal",
  "api_only",
]);
const BILLING_CYCLE_ENUM = new Set([
  "monthly",
  "quarterly",
  "yearly",
  "custom",
]);

const toSnakeCaseKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

const assertStringRequired = (value, fieldName) => {
  if (typeof value !== "string" || value.trim() === "") {
    const error = new Error(`${fieldName} is required`);
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
};

const assertBooleanStrict = (value, fieldName) => {
  if (typeof value !== "boolean") {
    const error = new Error(`${fieldName} must be a boolean`);
    error.statusCode = 400;
    throw error;
  }
  return value;
};

const assertEnum = (value, allowedSet, fieldName) => {
  if (!allowedSet.has(value)) {
    const error = new Error(
      `Invalid ${fieldName}. Allowed values: ${Array.from(allowedSet).join(", ")}`,
    );
    error.statusCode = 400;
    throw error;
  }
  return value;
};

const ensureIndustryExists = async (industry_id) => {
  const industry = await db.Industries.findOne({
    where: { industry_id },
    raw: true,
  });
  if (!industry) {
    const error = new Error("Industry not found");
    error.statusCode = 404;
    throw error;
  }
  return industry;
};

const ensureModuleExists = async (module_id) => {
  const module = await db.SaaSModules.findOne({
    where: { module_id },
    raw: true,
  });
  if (!module) {
    const error = new Error("SaaS module not found");
    error.statusCode = 404;
    throw error;
  }
  return module;
};

const ensurePlanExists = async (plan_id) => {
  const plan = await db.Plans.findOne({
    where: { plan_id },
    raw: true,
  });
  if (!plan) {
    const error = new Error("Plan not found");
    error.statusCode = 404;
    throw error;
  }
  return plan;
};

const ensureTenantExists = async (tenant_id) => {
  const tenant = await db.Tenants.findOne({
    where: { tenant_id, is_deleted: false },
    raw: true,
  });
  if (!tenant) {
    const error = new Error("Tenant not found");
    error.statusCode = 404;
    throw error;
  }
  return tenant;
};

export const listIndustriesService = async () => {
  return db.Industries.findAll({
    order: [
      ["industry_name", "ASC"],
      ["industry_id", "ASC"],
    ],
    raw: true,
  });
};

export const createIndustryService = async (payload = {}) => {
  const industry_id = assertStringRequired(payload.industry_id, "industry_id");
  const rawKey = assertStringRequired(payload.industry_key, "industry_key");
  const industry_name = assertStringRequired(
    payload.industry_name,
    "industry_name",
  );
  const industry_key = toSnakeCaseKey(rawKey);

  if (!industry_key) {
    const error = new Error("industry_key is required");
    error.statusCode = 400;
    throw error;
  }

  if (payload.is_active !== undefined) {
    assertBooleanStrict(payload.is_active, "is_active");
  }

  const [byId, byKey] = await Promise.all([
    db.Industries.findOne({ where: { industry_id }, raw: true }),
    db.Industries.findOne({ where: { industry_key }, raw: true }),
  ]);

  if (byId) {
    const error = new Error("industry_id already exists");
    error.statusCode = 400;
    throw error;
  }

  if (byKey) {
    const error = new Error("industry_key already exists");
    error.statusCode = 400;
    throw error;
  }

  await db.Industries.create({
    industry_id,
    industry_key,
    industry_name,
    description: payload.description ?? null,
    is_active: payload.is_active ?? true,
    metadata: payload.metadata ?? null,
  });

  return ensureIndustryExists(industry_id);
};

export const patchIndustryService = async (industryId, payload = {}) => {
  const industry_id = assertStringRequired(industryId, "industryId");
  await ensureIndustryExists(industry_id);

  const updates = {};
  if (payload.industry_key !== undefined) {
    const normalized = toSnakeCaseKey(payload.industry_key);
    if (!normalized) {
      const error = new Error("industry_key is required");
      error.statusCode = 400;
      throw error;
    }
    updates.industry_key = normalized;
  }
  if (payload.industry_name !== undefined) {
    updates.industry_name = assertStringRequired(
      payload.industry_name,
      "industry_name",
    );
  }
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.metadata !== undefined) updates.metadata = payload.metadata;
  if (payload.is_active !== undefined) {
    updates.is_active = assertBooleanStrict(payload.is_active, "is_active");
  }

  if (Object.keys(updates).length === 0) {
    const error = new Error("No valid fields provided for update");
    error.statusCode = 400;
    throw error;
  }

  if (updates.industry_key) {
    const duplicate = await db.Industries.findOne({
      where: {
        industry_key: updates.industry_key,
        industry_id: { [Op.ne]: industry_id },
      },
      raw: true,
    });
    if (duplicate) {
      const error = new Error("industry_key already exists");
      error.statusCode = 400;
      throw error;
    }
  }

  await db.Industries.update(updates, { where: { industry_id } });
  return ensureIndustryExists(industry_id);
};

export const listSaaSModulesService = async () => {
  return db.SaaSModules.findAll({
    order: [
      ["sort_order", "ASC"],
      ["module_name", "ASC"],
    ],
    raw: true,
  });
};

export const createSaaSModuleService = async (payload = {}) => {
  const module_id = assertStringRequired(payload.module_id, "module_id");
  const rawKey = assertStringRequired(payload.module_key, "module_key");
  const module_name = assertStringRequired(payload.module_name, "module_name");
  const module_key = toSnakeCaseKey(rawKey);

  if (!module_key) {
    const error = new Error("module_key is required");
    error.statusCode = 400;
    throw error;
  }

  if (payload.is_active !== undefined) {
    assertBooleanStrict(payload.is_active, "is_active");
  }
  if (payload.is_system_core !== undefined) {
    assertBooleanStrict(payload.is_system_core, "is_system_core");
  }
  if (payload.module_type !== undefined) {
    assertEnum(payload.module_type, MODULE_TYPE_ENUM, "module_type");
  }
  if (payload.visibility_type !== undefined) {
    assertEnum(payload.visibility_type, VISIBILITY_TYPE_ENUM, "visibility_type");
  }

  if (payload.parent_module_id) {
    await ensureModuleExists(assertStringRequired(payload.parent_module_id, "parent_module_id"));
  }

  const [byId, byKey] = await Promise.all([
    db.SaaSModules.findOne({ where: { module_id }, raw: true }),
    db.SaaSModules.findOne({ where: { module_key }, raw: true }),
  ]);

  if (byId) {
    const error = new Error("module_id already exists");
    error.statusCode = 400;
    throw error;
  }

  if (byKey) {
    const error = new Error("module_key already exists");
    error.statusCode = 400;
    throw error;
  }

  await db.SaaSModules.create({
    module_id,
    module_key,
    module_name,
    description: payload.description ?? null,
    category: payload.category ?? null,
    parent_module_id: payload.parent_module_id ?? null,
    route_path: payload.route_path ?? null,
    icon_key: payload.icon_key ?? null,
    module_type: payload.module_type ?? "feature",
    visibility_type: payload.visibility_type ?? "sidebar",
    is_system_core: payload.is_system_core ?? false,
    is_active: payload.is_active ?? true,
    sort_order: payload.sort_order ?? 0,
    metadata: payload.metadata ?? null,
  });

  return ensureModuleExists(module_id);
};

export const patchSaaSModuleService = async (moduleId, payload = {}) => {
  const module_id = assertStringRequired(moduleId, "moduleId");
  await ensureModuleExists(module_id);

  const updates = {};
  if (payload.module_key !== undefined) {
    const normalized = toSnakeCaseKey(payload.module_key);
    if (!normalized) {
      const error = new Error("module_key is required");
      error.statusCode = 400;
      throw error;
    }
    updates.module_key = normalized;
  }
  if (payload.module_name !== undefined) {
    updates.module_name = assertStringRequired(payload.module_name, "module_name");
  }
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.category !== undefined) updates.category = payload.category;
  if (payload.route_path !== undefined) updates.route_path = payload.route_path;
  if (payload.icon_key !== undefined) updates.icon_key = payload.icon_key;
  if (payload.sort_order !== undefined) updates.sort_order = payload.sort_order;
  if (payload.metadata !== undefined) updates.metadata = payload.metadata;
  if (payload.parent_module_id !== undefined) {
    if (payload.parent_module_id === null) {
      updates.parent_module_id = null;
    } else {
      const parentId = assertStringRequired(payload.parent_module_id, "parent_module_id");
      if (parentId === module_id) {
        const error = new Error("parent_module_id cannot be same as module_id");
        error.statusCode = 400;
        throw error;
      }
      await ensureModuleExists(parentId);
      updates.parent_module_id = parentId;
    }
  }
  if (payload.is_active !== undefined) {
    updates.is_active = assertBooleanStrict(payload.is_active, "is_active");
  }
  if (payload.is_system_core !== undefined) {
    updates.is_system_core = assertBooleanStrict(
      payload.is_system_core,
      "is_system_core",
    );
  }
  if (payload.module_type !== undefined) {
    updates.module_type = assertEnum(
      payload.module_type,
      MODULE_TYPE_ENUM,
      "module_type",
    );
  }
  if (payload.visibility_type !== undefined) {
    updates.visibility_type = assertEnum(
      payload.visibility_type,
      VISIBILITY_TYPE_ENUM,
      "visibility_type",
    );
  }

  if (Object.keys(updates).length === 0) {
    const error = new Error("No valid fields provided for update");
    error.statusCode = 400;
    throw error;
  }

  if (updates.module_key) {
    const duplicate = await db.SaaSModules.findOne({
      where: {
        module_key: updates.module_key,
        module_id: { [Op.ne]: module_id },
      },
      raw: true,
    });
    if (duplicate) {
      const error = new Error("module_key already exists");
      error.statusCode = 400;
      throw error;
    }
  }

  await db.SaaSModules.update(updates, { where: { module_id } });
  return ensureModuleExists(module_id);
};

export const listPlansService = async () => {
  return db.Plans.findAll({
    order: [
      ["sort_order", "ASC"],
      ["plan_name", "ASC"],
    ],
    raw: true,
  });
};

export const createPlanService = async (payload = {}) => {
  const plan_id = assertStringRequired(payload.plan_id, "plan_id");
  const rawKey = assertStringRequired(payload.plan_key, "plan_key");
  const plan_name = assertStringRequired(payload.plan_name, "plan_name");
  const plan_key = toSnakeCaseKey(rawKey);

  if (!plan_key) {
    const error = new Error("plan_key is required");
    error.statusCode = 400;
    throw error;
  }

  if (payload.is_active !== undefined) {
    assertBooleanStrict(payload.is_active, "is_active");
  }
  if (payload.billing_cycle !== undefined && payload.billing_cycle !== null) {
    assertEnum(payload.billing_cycle, BILLING_CYCLE_ENUM, "billing_cycle");
  }

  const [byId, byKey] = await Promise.all([
    db.Plans.findOne({ where: { plan_id }, raw: true }),
    db.Plans.findOne({ where: { plan_key }, raw: true }),
  ]);

  if (byId) {
    const error = new Error("plan_id already exists");
    error.statusCode = 400;
    throw error;
  }

  if (byKey) {
    const error = new Error("plan_key already exists");
    error.statusCode = 400;
    throw error;
  }

  await db.Plans.create({
    plan_id,
    plan_key,
    plan_name,
    description: payload.description ?? null,
    price: payload.price ?? null,
    billing_cycle: payload.billing_cycle ?? null,
    sort_order: payload.sort_order ?? 0,
    is_active: payload.is_active ?? true,
    metadata: payload.metadata ?? null,
  });

  return ensurePlanExists(plan_id);
};

export const patchPlanService = async (planId, payload = {}) => {
  const plan_id = assertStringRequired(planId, "planId");
  await ensurePlanExists(plan_id);

  const updates = {};
  if (payload.plan_key !== undefined) {
    const normalized = toSnakeCaseKey(payload.plan_key);
    if (!normalized) {
      const error = new Error("plan_key is required");
      error.statusCode = 400;
      throw error;
    }
    updates.plan_key = normalized;
  }
  if (payload.plan_name !== undefined) {
    updates.plan_name = assertStringRequired(payload.plan_name, "plan_name");
  }
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.price !== undefined) updates.price = payload.price;
  if (payload.sort_order !== undefined) updates.sort_order = payload.sort_order;
  if (payload.metadata !== undefined) updates.metadata = payload.metadata;
  if (payload.is_active !== undefined) {
    updates.is_active = assertBooleanStrict(payload.is_active, "is_active");
  }
  if (payload.billing_cycle !== undefined) {
    if (payload.billing_cycle === null) {
      updates.billing_cycle = null;
    } else {
      updates.billing_cycle = assertEnum(
        payload.billing_cycle,
        BILLING_CYCLE_ENUM,
        "billing_cycle",
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    const error = new Error("No valid fields provided for update");
    error.statusCode = 400;
    throw error;
  }

  if (updates.plan_key) {
    const duplicate = await db.Plans.findOne({
      where: {
        plan_key: updates.plan_key,
        plan_id: { [Op.ne]: plan_id },
      },
      raw: true,
    });
    if (duplicate) {
      const error = new Error("plan_key already exists");
      error.statusCode = 400;
      throw error;
    }
  }

  await db.Plans.update(updates, { where: { plan_id } });
  return ensurePlanExists(plan_id);
};

export const getIndustrySaaSModulesService = async (industryId) => {
  const industry_id = assertStringRequired(industryId, "industryId");
  const industry = await ensureIndustryExists(industry_id);

  const mappings = await db.IndustrySaaSModules.findAll({
    where: { industry_id },
    order: [["module_id", "ASC"]],
    raw: true,
  });

  return {
    industry,
    mappings,
  };
};

export const patchIndustrySaaSModulesService = async (industryId, mappings) => {
  const industry_id = assertStringRequired(industryId, "industryId");
  await ensureIndustryExists(industry_id);

  if (!Array.isArray(mappings)) {
    const error = new Error("mappings must be an array");
    error.statusCode = 400;
    throw error;
  }

  const seen = new Set();
  const normalized = [];

  for (const item of mappings) {
    const module_id = assertStringRequired(item?.module_id, "module_id");
    const is_enabled = assertBooleanStrict(item?.is_enabled, "is_enabled");
    if (seen.has(module_id)) {
      const error = new Error(`Duplicate module_id in mappings: ${module_id}`);
      error.statusCode = 400;
      throw error;
    }
    seen.add(module_id);
    await ensureModuleExists(module_id);
    normalized.push({
      industry_id,
      module_id,
      is_enabled,
      metadata: item?.metadata ?? null,
    });
  }

  await db.sequelize.transaction(async (transaction) => {
    await db.IndustrySaaSModules.destroy({
      where: { industry_id },
      transaction,
    });

    if (normalized.length > 0) {
      await db.IndustrySaaSModules.bulkCreate(normalized, { transaction });
    }
  });

  return getIndustrySaaSModulesService(industry_id);
};

export const getPlanSaaSModulesService = async (planId) => {
  const plan_id = assertStringRequired(planId, "planId");
  const plan = await ensurePlanExists(plan_id);

  const mappings = await db.PlanSaaSModules.findAll({
    where: { plan_id },
    order: [["module_id", "ASC"]],
    raw: true,
  });

  return {
    plan,
    mappings,
  };
};

export const patchPlanSaaSModulesService = async (planId, mappings) => {
  const plan_id = assertStringRequired(planId, "planId");
  await ensurePlanExists(plan_id);

  if (!Array.isArray(mappings)) {
    const error = new Error("mappings must be an array");
    error.statusCode = 400;
    throw error;
  }

  const seen = new Set();
  const normalized = [];

  for (const item of mappings) {
    const module_id = assertStringRequired(item?.module_id, "module_id");
    const is_enabled = assertBooleanStrict(item?.is_enabled, "is_enabled");
    if (seen.has(module_id)) {
      const error = new Error(`Duplicate module_id in mappings: ${module_id}`);
      error.statusCode = 400;
      throw error;
    }
    seen.add(module_id);
    await ensureModuleExists(module_id);
    normalized.push({
      plan_id,
      module_id,
      is_enabled,
      metadata: item?.metadata ?? null,
    });
  }

  await db.sequelize.transaction(async (transaction) => {
    await db.PlanSaaSModules.destroy({
      where: { plan_id },
      transaction,
    });

    if (normalized.length > 0) {
      await db.PlanSaaSModules.bulkCreate(normalized, { transaction });
    }
  });

  return getPlanSaaSModulesService(plan_id);
};

export const getManagementTenantDynamicAccessService = async (tenantId) => {
  const tenant_id = assertStringRequired(tenantId, "tenantId");
  await ensureTenantExists(tenant_id);
  return getTenantDynamicAccessService(tenant_id);
};

export const patchManagementTenantDynamicAccessService = async (
  tenantId,
  payload = {},
) => {
  const tenant_id = assertStringRequired(tenantId, "tenantId");
  await ensureTenantExists(tenant_id);

  if (payload && Object.prototype.hasOwnProperty.call(payload, "tenant_id")) {
    const error = new Error(
      "tenant_id is not allowed in request body. Use route param tenantId.",
    );
    error.statusCode = 400;
    throw error;
  }

  const updates = {};
  const hasIndustryField = Object.prototype.hasOwnProperty.call(
    payload,
    "industry_id",
  );
  const hasPlanField = Object.prototype.hasOwnProperty.call(payload, "plan_id");
  const hasOverridesField = Object.prototype.hasOwnProperty.call(
    payload,
    "overrides",
  );

  if (hasIndustryField) {
    if (payload.industry_id === null) {
      updates.industry_id = null;
    } else {
      updates.industry_id = assertStringRequired(payload.industry_id, "industry_id");
      await ensureIndustryExists(updates.industry_id);
    }
  }

  if (hasPlanField) {
    if (payload.plan_id === null) {
      updates.plan_id = null;
    } else {
      updates.plan_id = assertStringRequired(payload.plan_id, "plan_id");
      await ensurePlanExists(updates.plan_id);
    }
  }

  let normalizedOverrides = null;
  if (hasOverridesField) {
    if (!Array.isArray(payload.overrides)) {
      const error = new Error("overrides must be an array");
      error.statusCode = 400;
      throw error;
    }

    const seen = new Set();
    normalizedOverrides = [];
    for (const item of payload.overrides) {
      const module_id = assertStringRequired(item?.module_id, "module_id");
      const is_enabled = assertBooleanStrict(item?.is_enabled, "is_enabled");

      if (seen.has(module_id)) {
        const error = new Error(`Duplicate module_id in overrides: ${module_id}`);
        error.statusCode = 400;
        throw error;
      }
      seen.add(module_id);

      const module = await db.SaaSModules.findOne({
        where: { module_id },
        raw: true,
      });

      if (!module || !Boolean(module.is_active)) {
        const error = new Error(
          `Override rejected for module_id ${module_id}: unknown or inactive module`,
        );
        error.statusCode = 400;
        throw error;
      }

      if (Boolean(module.is_system_core) && is_enabled === false) {
        const error = new Error(
          `Override rejected for module_id ${module_id}: system core module cannot be disabled`,
        );
        error.statusCode = 400;
        throw error;
      }

      normalizedOverrides.push({
        tenant_id,
        module_id,
        is_enabled,
        metadata: item?.metadata ?? null,
      });
    }
  }

  if (!hasIndustryField && !hasPlanField && !hasOverridesField) {
    const error = new Error(
      "At least one of industry_id, plan_id, overrides is required",
    );
    error.statusCode = 400;
    throw error;
  }

  await db.sequelize.transaction(async (transaction) => {
    if (Object.keys(updates).length > 0) {
      await db.Tenants.update(updates, {
        where: { tenant_id, is_deleted: false },
        transaction,
      });
    }

    if (hasOverridesField) {
      await db.TenantSaaSModuleOverrides.destroy({
        where: { tenant_id },
        transaction,
      });

      if (normalizedOverrides.length > 0) {
        await db.TenantSaaSModuleOverrides.bulkCreate(normalizedOverrides, {
          transaction,
        });
      }
    }
  });

  return getTenantDynamicAccessService(tenant_id);
};
