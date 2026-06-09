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
  "knowledge",
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
    key: "knowledge",
    label: "Knowledge Base",
    category: "common",
    group: "Knowledge Base",
    route: "/knowledge?tab=data-sources",
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
  