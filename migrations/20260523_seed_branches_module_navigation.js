/**
 * Migration: seed branches module access + navigation registration
 *
 * Run manually (from Backend/):
 *   node migrations/20260523_seed_branches_module_navigation.js
 *   node migrations/20260523_seed_branches_module_navigation.js down
 */

import db from "../src/database/index.js";

const SEED_TAG = "20260523_seed_branches_module_navigation";

const BRANCH_MODULE = {
  module_id: "mod_branches",
  module_key: "branches",
  module_name: "Branches",
  category: "healthcare",
  route_path: "/branches",
  icon_key: "branches",
  module_type: "feature",
  visibility_type: "sidebar",
  is_system_core: false,
  is_active: true,
  sort_order: 17,
};

const NAV_BRANCH = {
  navigation_item_id: "nav_branches",
  label: "Branches",
  route_path: "/branches",
  icon_key: "branches",
  menu_group: "Team Management",
  sort_order: 17,
  is_visible: true,
  is_active: true,
};

const TEAM_SECTION = {
  sidebar_section_id: "sec_team_management",
  section_key: "team_management",
  title: "Team Management",
  assignment_mode: "global",
  is_visible: true,
  is_active: true,
  is_system_core: false,
  sort_order: 4,
};

const parseMetadata = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
};

const seededMetadata = (existingMetadata = null, extra = {}) => ({
  ...parseMetadata(existingMetadata),
  ...extra,
  seeded_from: SEED_TAG,
});

const upsertBranchModule = async (transaction) => {
  const existingById = await db.SaaSModules.findOne({
    where: { module_id: BRANCH_MODULE.module_id },
    transaction,
  });
  const existingByKey = await db.SaaSModules.findOne({
    where: { module_key: BRANCH_MODULE.module_key },
    transaction,
  });

  const target = existingById || existingByKey;
  if (!target) {
    await db.SaaSModules.create(
      {
        ...BRANCH_MODULE,
        metadata: seededMetadata(null, {
          placement: "team_management",
        }),
      },
      { transaction },
    );
    return BRANCH_MODULE.module_id;
  }

  await db.SaaSModules.update(
    {
      module_key: BRANCH_MODULE.module_key,
      module_name: BRANCH_MODULE.module_name,
      category: BRANCH_MODULE.category,
      route_path: BRANCH_MODULE.route_path,
      icon_key: BRANCH_MODULE.icon_key,
      module_type: BRANCH_MODULE.module_type,
      visibility_type: BRANCH_MODULE.visibility_type,
      is_system_core: BRANCH_MODULE.is_system_core,
      is_active: BRANCH_MODULE.is_active,
      sort_order: BRANCH_MODULE.sort_order,
      metadata: seededMetadata(target.metadata, {
        placement: "team_management",
      }),
    },
    {
      where: { module_id: target.module_id },
      transaction,
    },
  );

  return target.module_id;
};

const ensureIndustryMapping = async (module_id, transaction) => {
  const row = await db.IndustrySaaSModules.findOne({
    where: {
      industry_id: "healthcare",
      module_id,
    },
    transaction,
  });

  if (!row) {
    await db.IndustrySaaSModules.create(
      {
        industry_id: "healthcare",
        module_id,
        is_enabled: true,
        metadata: seededMetadata(null),
      },
      { transaction },
    );
    return;
  }

  await db.IndustrySaaSModules.update(
    {
      is_enabled: true,
      metadata: seededMetadata(row.metadata),
    },
    {
      where: {
        industry_id: "healthcare",
        module_id,
      },
      transaction,
    },
  );
};

const getTargetPlans = async (transaction) => {
  const doctorsModule = await db.SaaSModules.findOne({
    where: { module_key: "doctors" },
    attributes: ["module_id"],
    raw: true,
    transaction,
  });

  if (doctorsModule?.module_id) {
    const rows = await db.PlanSaaSModules.findAll({
      where: { module_id: doctorsModule.module_id },
      attributes: ["plan_id", "is_enabled"],
      raw: true,
      transaction,
    });

    if (rows.length > 0) return rows;
  }

  const defaultPlan = await db.Plans.findOne({
    where: { plan_id: "default_plan" },
    attributes: ["plan_id"],
    raw: true,
    transaction,
  });

  if (!defaultPlan) return [];
  return [{ plan_id: defaultPlan.plan_id, is_enabled: true }];
};

const ensurePlanMappings = async (module_id, transaction) => {
  const plans = await getTargetPlans(transaction);

  for (const plan of plans) {
    const row = await db.PlanSaaSModules.findOne({
      where: {
        plan_id: plan.plan_id,
        module_id,
      },
      transaction,
    });

    if (!row) {
      await db.PlanSaaSModules.create(
        {
          plan_id: plan.plan_id,
          module_id,
          is_enabled: Boolean(plan.is_enabled),
          metadata: seededMetadata(null),
        },
        { transaction },
      );
      continue;
    }

    await db.PlanSaaSModules.update(
      {
        is_enabled: Boolean(plan.is_enabled),
        metadata: seededMetadata(row.metadata),
      },
      {
        where: {
          plan_id: plan.plan_id,
          module_id,
        },
        transaction,
      },
    );
  }
};

const ensureTeamSection = async (transaction) => {
  const existing = await db.SidebarSections.findOne({
    where: {
      section_key: TEAM_SECTION.section_key,
    },
    transaction,
  });
  const existingByTitle = await db.SidebarSections.findOne({
    where: { title: TEAM_SECTION.title },
    transaction,
  });

  const target = existing || existingByTitle;
  if (!target) {
    await db.SidebarSections.create(
      {
        ...TEAM_SECTION,
        metadata: seededMetadata(null),
      },
      { transaction },
    );
    return TEAM_SECTION.sidebar_section_id;
  }

  await db.SidebarSections.update(
    {
      section_key: TEAM_SECTION.section_key,
      title: TEAM_SECTION.title,
      assignment_mode: TEAM_SECTION.assignment_mode,
      is_visible: TEAM_SECTION.is_visible,
      is_active: TEAM_SECTION.is_active,
      sort_order: TEAM_SECTION.sort_order,
      metadata: seededMetadata(target.metadata),
    },
    {
      where: { sidebar_section_id: target.sidebar_section_id },
      transaction,
    },
  );

  return target.sidebar_section_id;
};

const ensureSectionIndustry = async (sidebar_section_id, transaction) => {
  const row = await db.SidebarSectionIndustries.findOne({
    where: {
      sidebar_section_id,
      industry_id: "healthcare",
    },
    transaction,
  });

  if (!row) {
    await db.SidebarSectionIndustries.create(
      {
        sidebar_section_industry_id: `${sidebar_section_id}_healthcare`,
        sidebar_section_id,
        industry_id: "healthcare",
        is_active: true,
        metadata: seededMetadata(null),
      },
      { transaction },
    );
    return;
  }

  await db.SidebarSectionIndustries.update(
    {
      is_active: true,
      metadata: seededMetadata(row.metadata),
    },
    {
      where: {
        sidebar_section_id,
        industry_id: "healthcare",
      },
      transaction,
    },
  );
};

const ensureSectionPlans = async (sidebar_section_id, transaction) => {
  const plans = await getTargetPlans(transaction);

  for (const plan of plans) {
    const row = await db.SidebarSectionPlans.findOne({
      where: {
        sidebar_section_id,
        plan_id: plan.plan_id,
      },
      transaction,
    });

    if (!row) {
      await db.SidebarSectionPlans.create(
        {
          sidebar_section_plan_id: `${sidebar_section_id}_${plan.plan_id}`,
          sidebar_section_id,
          plan_id: plan.plan_id,
          is_active: Boolean(plan.is_enabled),
          metadata: seededMetadata(null),
        },
        { transaction },
      );
      continue;
    }

    await db.SidebarSectionPlans.update(
      {
        is_active: Boolean(plan.is_enabled),
        metadata: seededMetadata(row.metadata),
      },
      {
        where: {
          sidebar_section_id,
          plan_id: plan.plan_id,
        },
        transaction,
      },
    );
  }
};

const ensureBranchNavigation = async (
  module_id,
  sidebar_section_id,
  transaction,
) => {
  const byId = await db.NavigationItems.findOne({
    where: { navigation_item_id: NAV_BRANCH.navigation_item_id },
    transaction,
  });
  const byRoute = await db.NavigationItems.findOne({
    where: { route_path: NAV_BRANCH.route_path, tenant_id: null },
    transaction,
  });
  const target = byId || byRoute;

  if (!target) {
    await db.NavigationItems.create(
      {
        ...NAV_BRANCH,
        tenant_id: null,
        module_id,
        parent_item_id: null,
        sidebar_section_id,
        metadata: seededMetadata(null),
      },
      { transaction },
    );
  } else {
    await db.NavigationItems.update(
      {
        module_id,
        label: NAV_BRANCH.label,
        route_path: NAV_BRANCH.route_path,
        icon_key: NAV_BRANCH.icon_key,
        menu_group: NAV_BRANCH.menu_group,
        sidebar_section_id,
        sort_order: NAV_BRANCH.sort_order,
        is_visible: NAV_BRANCH.is_visible,
        is_active: NAV_BRANCH.is_active,
        metadata: seededMetadata(target.metadata),
      },
      {
        where: { navigation_item_id: target.navigation_item_id },
        transaction,
      },
    );
  }

  await db.NavigationItems.update(
    {
      menu_group: NAV_BRANCH.menu_group,
      sidebar_section_id,
    },
    {
      where: {
        navigation_item_id: ["nav_doctors", "nav_specialization"],
        tenant_id: null,
      },
      transaction,
    },
  );
};

const up = async () => {
  await db.sequelize.transaction(async (transaction) => {
    const module_id = await upsertBranchModule(transaction);
    await ensureIndustryMapping(module_id, transaction);
    await ensurePlanMappings(module_id, transaction);

    const sidebar_section_id = await ensureTeamSection(transaction);
    await ensureSectionIndustry(sidebar_section_id, transaction);
    await ensureSectionPlans(sidebar_section_id, transaction);
    await ensureBranchNavigation(module_id, sidebar_section_id, transaction);
  });
};

const down = async () => {
  await db.sequelize.transaction(async (transaction) => {
    const section = await db.SidebarSections.findOne({
      where: { section_key: TEAM_SECTION.section_key },
      transaction,
    });
    const sectionId = section?.sidebar_section_id || TEAM_SECTION.sidebar_section_id;

    await db.NavigationItems.destroy({
      where: {
        navigation_item_id: NAV_BRANCH.navigation_item_id,
      },
      transaction,
    });

    await db.SidebarSectionPlans.destroy({
      where: {
        sidebar_section_id: sectionId,
      },
      transaction,
    });

    await db.SidebarSectionIndustries.destroy({
      where: {
        sidebar_section_id: sectionId,
        industry_id: "healthcare",
      },
      transaction,
    });

    await db.SidebarSections.destroy({
      where: {
        sidebar_section_id: sectionId,
        section_key: TEAM_SECTION.section_key,
      },
      transaction,
    });

    await db.PlanSaaSModules.destroy({
      where: {
        module_id: BRANCH_MODULE.module_id,
      },
      transaction,
    });

    await db.IndustrySaaSModules.destroy({
      where: {
        industry_id: "healthcare",
        module_id: BRANCH_MODULE.module_id,
      },
      transaction,
    });

    await db.SaaSModules.destroy({
      where: {
        module_id: BRANCH_MODULE.module_id,
        module_key: BRANCH_MODULE.module_key,
      },
      transaction,
    });
  });
};

const run = async () => {
  const direction = process.argv[2] === "down" ? "down" : "up";
  