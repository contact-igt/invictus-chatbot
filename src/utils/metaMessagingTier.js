const TIER_CONFIG = Object.freeze({
  TIER_50: {
    name: "50",
    dailyLimit: 50,
  },
  TIER_250: {
    name: "250",
    dailyLimit: 250,
    upgradeTarget: 2000,
    upgradeWindowDays: 30,
    nextTierKey: "TIER_2K",
    allowsVerificationPath: true,
    requiresHighQuality: true,
  },
  TIER_2K: {
    name: "2K",
    dailyLimit: 2000,
    upgradeTarget: 1000,
    upgradeWindowDays: 7,
    nextTierKey: "TIER_10K",
    requiresHighQuality: true,
  },
  TIER_10K: {
    name: "10K",
    dailyLimit: 10000,
    upgradeTarget: 5000,
    upgradeWindowDays: 7,
    nextTierKey: "TIER_100K",
    requiresHighQuality: true,
  },
  TIER_100K: {
    name: "100K",
    dailyLimit: 100000,
    upgradeTarget: 50000,
    upgradeWindowDays: 7,
    nextTierKey: "TIER_UNLIMITED",
    requiresHighQuality: true,
  },
  TIER_UNLIMITED: {
    name: "Unlimited",
    dailyLimit: null,
    isUnlimited: true,
  },
});

const LEGACY_TIER_KEYS = Object.freeze({
  "10K MSG LIMIT": "TIER_10K",
  "100K MSG LIMIT": "TIER_100K",
  UNLIMITED: "TIER_UNLIMITED",
});

export const META_TIER_KEYS = Object.freeze([
  "TIER_50",
  "TIER_250",
  "TIER_2K",
  "TIER_10K",
  "TIER_100K",
  "TIER_UNLIMITED",
  "UNTIERED",
]);

export const resolveMetaTier = (rawTier) => {
  const rawKey = String(rawTier || "TIER_NOT_SET").trim().toUpperCase();
  const tierKey = LEGACY_TIER_KEYS[rawKey] || rawKey;
  const config = TIER_CONFIG[tierKey];

  if (!config) {
    return {
      tierKey,
      tierName: "Unknown",
      dailyLimit: null,
      isUnlimited: false,
      isKnown: false,
      upgradeTarget: null,
      upgradeWindowDays: null,
      nextTierKey: null,
      allowsVerificationPath: false,
      requiresHighQuality: false,
    };
  }

  return {
    tierKey,
    tierName: config.name,
    dailyLimit: config.dailyLimit,
    isUnlimited: config.isUnlimited === true,
    isKnown: true,
    upgradeTarget: config.upgradeTarget ?? null,
    upgradeWindowDays: config.upgradeWindowDays ?? null,
    nextTierKey: config.nextTierKey ?? null,
    allowsVerificationPath: config.allowsVerificationPath === true,
    requiresHighQuality: config.requiresHighQuality === true,
  };
};

export const isPersistableMetaTier = (rawTier) => {
  const tierKey = String(rawTier || "").trim().toUpperCase();
  return META_TIER_KEYS.includes(tierKey) || tierKey === "TIER_NOT_SET";
};

export const normalizeMetaTierWebhookValue = (value) => {
  const numericTiers = new Map([
    [50, "TIER_50"],
    [250, "TIER_250"],
    [2000, "TIER_2K"],
    [10000, "TIER_10K"],
    [100000, "TIER_100K"],
  ]);
  if (value === null || value === undefined || value === "") return null;
  if (String(value).toUpperCase() === "UNLIMITED") return "TIER_UNLIMITED";
  return numericTiers.get(Number(value)) || String(value).toUpperCase();
};
