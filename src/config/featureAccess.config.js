export const INDUSTRY_TYPES = ["healthcare", "education", "general"];

export const COMMON_FEATURES = [
  "dashboard",
  "chat",
  "history",
  "leadpool",
  "contacts",
  "groups",
  "templates",
  "campaign",
  "media_gallery",
  "agent_matrix",
  "billing_payment",
  "general_settings",
  "fallback",
];

export const INDUSTRY_FEATURES = {
  healthcare: ["doctors", "appointments", "specialization"],
  education: ["courses", "sessions", "mentors"],
  general: [],
};

export const FEATURE_METADATA = [
  {
    key: "dashboard",
    label: "Dashboard",
    category: "common",
    group: "Common",
    route: "/dashboard",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "chat",
    label: "Chat",
    category: "common",
    group: "Common",
    route: "/shared-inbox/live-chats",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "history",
    label: "History",
    category: "common",
    group: "Common",
    route: "/shared-inbox/history",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "leadpool",
    label: "Lead Pool",
    category: "common",
    group: "Common",
    route: "/leads",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "contacts",
    label: "Contacts",
    category: "common",
    group: "Common",
    route: "/contacts/contacts",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "groups",
    label: "Groups",
    category: "common",
    group: "Common",
    route: "/contacts/groups",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "templates",
    label: "Templates",
    category: "common",
    group: "Common",
    route: "/templates",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "campaign",
    label: "Campaign",
    category: "common",
    group: "Common",
    route: "/campaign",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "media_gallery",
    label: "Media Gallery",
    category: "common",
    group: "Common",
    route: "/gallery",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "agent_matrix",
    label: "Agent Matrix",
    category: "common",
    group: "Common",
    route: "/team",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "billing_payment",
    label: "Billing & Payment",
    category: "common",
    group: "Common",
    route: "/billing",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "general_settings",
    label: "General Settings",
    category: "common",
    group: "Common",
    route: "/settings/general",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "fallback",
    label: "Fallback",
    category: "common",
    group: "Common",
    route: "/dashboard",
    isCommon: true,
    allowedIndustries: INDUSTRY_TYPES,
  },
  {
    key: "doctors",
    label: "Doctors",
    category: "healthcare",
    group: "Healthcare",
    route: "/doctors",
    isCommon: false,
    allowedIndustries: ["healthcare"],
  },
  {
    key: "appointments",
    label: "Appointments",
    category: "healthcare",
    group: "Healthcare",
    route: "/appointments",
    isCommon: false,
    allowedIndustries: ["healthcare"],
  },
  {
    key: "specialization",
    label: "Specialization",
    category: "healthcare",
    group: "Healthcare",
    route: "/specialization",
    isCommon: false,
    allowedIndustries: ["healthcare"],
  },
  {
    key: "courses",
    label: "Courses",
    category: "education",
    group: "Education",
    route: "/courses",
    isCommon: false,
    allowedIndustries: ["education"],
  },
  {
    key: "sessions",
    label: "Sessions",
    category: "education",
    group: "Education",
    route: "/courses/sessions",
    isCommon: false,
    allowedIndustries: ["education"],
  },
  {
    key: "mentors",
    label: "Mentors",
    category: "education",
    group: "Education",
    route: "/courses/mentors",
    isCommon: false,
    allowedIndustries: ["education"],
  },
];

const FEATURE_KEY_SET = new Set(FEATURE_METADATA.map((feature) => feature.key));

export const isValidIndustryType = (industryType) =>
  INDUSTRY_TYPES.includes(industryType);

export const getDefaultFeaturesForIndustry = (industryType = "general") => {
  const resolvedIndustry = isValidIndustryType(industryType)
    ? industryType
    : "general";
  const industryFeatures = INDUSTRY_FEATURES[resolvedIndustry] || [];
  return [...new Set([...COMMON_FEATURES, ...industryFeatures])];
};

export const resolveTenantFeatureAccess = (
  industryType = "general",
  overrides = [],
) => {
  const defaultFeatures = getDefaultFeaturesForIndustry(industryType);
  const enabledSet = new Set(defaultFeatures);

  for (const override of overrides) {
    const featureKey = override?.feature_key;
    if (!FEATURE_KEY_SET.has(featureKey)) continue;

    if (override?.is_enabled) enabledSet.add(featureKey);
    else enabledSet.delete(featureKey);
  }

  const enabledFeatures = [...enabledSet];
  const disabledFeatures = FEATURE_METADATA.map((feature) => feature.key).filter(
    (featureKey) => !enabledSet.has(featureKey),
  );

  return {
    industry_type: isValidIndustryType(industryType) ? industryType : "general",
    default_features: defaultFeatures,
    enabled_features: enabledFeatures,
    disabled_features: disabledFeatures,
  };
};

export const isValidFeatureKey = (featureKey) => FEATURE_KEY_SET.has(featureKey);
