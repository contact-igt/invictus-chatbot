/**
 * Plain node:assert suite (matches the repo's existing convention).
 * Run: node src/utils/metaMessagingTier.test.js
 */
import assert from "node:assert/strict";
import {
  META_TIER_KEYS,
  isPersistableMetaTier,
  normalizeMetaTierWebhookValue,
  resolveMetaTier,
} from "./metaMessagingTier.js";

// ── Every supported tier resolves to the right limit ────────────────────────
assert.equal(resolveMetaTier("TIER_50").dailyLimit, 50);
assert.equal(resolveMetaTier("TIER_250").dailyLimit, 250);
assert.equal(resolveMetaTier("TIER_2K").dailyLimit, 2000);
assert.equal(resolveMetaTier("TIER_10K").dailyLimit, 10000);
assert.equal(resolveMetaTier("TIER_100K").dailyLimit, 100000);

const unlimited = resolveMetaTier("TIER_UNLIMITED");
assert.equal(unlimited.isUnlimited, true);
assert.equal(unlimited.isKnown, true);
assert.equal(unlimited.dailyLimit, null, "unlimited limit must be null, never Infinity");

// ── Unknown / not-set / untiered must NOT become Trial or 250 ───────────────
for (const raw of ["UNTIERED", "TIER_NOT_SET", "SOMETHING_FROM_2027", "", null, undefined]) {
  const r = resolveMetaTier(raw);
  assert.equal(r.isKnown, false, `${raw} should be unknown`);
  assert.equal(r.dailyLimit, null, `${raw} must not have a numeric limit`);
  assert.notEqual(r.tierName, "Trial", `${raw} must not be labelled Trial`);
  assert.equal(r.isUnlimited, false);
}

// ── Legacy label salvage ───────────────────────────────────────────────────
assert.equal(resolveMetaTier("10K MSG LIMIT").tierKey, "TIER_10K");
assert.equal(resolveMetaTier("100K MSG LIMIT").tierKey, "TIER_100K");
assert.equal(resolveMetaTier("unlimited").tierKey, "TIER_UNLIMITED");

// ── Upgrade contract ───────────────────────────────────────────────────────
assert.equal(resolveMetaTier("TIER_250").upgradeTarget, 2000);
assert.equal(resolveMetaTier("TIER_250").upgradeWindowDays, 30);
assert.equal(resolveMetaTier("TIER_250").allowsVerificationPath, true);
assert.equal(resolveMetaTier("TIER_2K").upgradeTarget, 1000);
assert.equal(resolveMetaTier("TIER_10K").upgradeTarget, 5000);
assert.equal(resolveMetaTier("TIER_100K").upgradeTarget, 50000);
assert.equal(resolveMetaTier("TIER_2K").allowsVerificationPath, false);
assert.equal(resolveMetaTier("TIER_2K").requiresHighQuality, true);

// ── Persistence guard: only recognised values (or TIER_NOT_SET) may be written ─
for (const key of META_TIER_KEYS) assert.equal(isPersistableMetaTier(key), true);
assert.equal(isPersistableMetaTier("TIER_NOT_SET"), true);
assert.equal(isPersistableMetaTier("tier_2k"), true, "case-insensitive");
for (const bad of ["", null, undefined, "GARBAGE", "TIER_9000"]) {
  assert.equal(isPersistableMetaTier(bad), false, `${bad} must not be persistable`);
}
// This is the exact rule syncWabaMetaInfoService uses to preserve the last known
// tier when Meta omits or garbles the field:
const previousTier = "TIER_10K";
const metaOmitted = null;
const tierForDb = isPersistableMetaTier(metaOmitted) ? metaOmitted : previousTier;
assert.equal(tierForDb, "TIER_10K", "a partial Meta response must not destroy the cached tier");

// ── Webhook value normalisation ────────────────────────────────────────────
assert.equal(normalizeMetaTierWebhookValue(50), "TIER_50");
assert.equal(normalizeMetaTierWebhookValue(250), "TIER_250");
assert.equal(normalizeMetaTierWebhookValue(2000), "TIER_2K");
assert.equal(normalizeMetaTierWebhookValue(100000), "TIER_100K");
assert.equal(normalizeMetaTierWebhookValue("UNLIMITED"), "TIER_UNLIMITED");
assert.equal(normalizeMetaTierWebhookValue(null), null);
assert.equal(normalizeMetaTierWebhookValue(""), null);

console.log("metaMessagingTier tests passed");
