/**
 * Plain node:assert suite. Run: node src/utils/metaErrorClassifier.test.js
 */
import assert from "node:assert/strict";
import {
  classifyMetaError,
  isFinallyPermanent,
  isLocalMetaCapacityError,
  isMetaAccountRestrictionError,
  isNetworkSystemError,
} from "./metaErrorClassifier.js";

const metaErr = (code) => ({ response: { data: { error: { code } } } });

// ── Throughput / rate limiting → retryable, not permanent ───────────────────
for (const code of [130429, 80007, 131056]) {
  assert.equal(isFinallyPermanent(metaErr(code)), false, `${code} must be retryable`);
}

// ── Account restriction / spam limiting → its own class, not "invalid recipient" ─
for (const code of [131031, 131048]) {
  assert.equal(isMetaAccountRestrictionError(metaErr(code)), true, `${code} is an account restriction`);
  assert.equal(isFinallyPermanent(metaErr(code)), false, `${code} must not permanently fail the recipient`);
}
assert.equal(
  isMetaAccountRestrictionError({ meta_account_restriction: true }),
  true,
  "explicit flag from the local tier guard is honoured",
);

// ── Transient infrastructure → retryable ───────────────────────────────────
assert.equal(isFinallyPermanent({ response: { status: 500 } }), false, "HTTP 500 is transient");
assert.equal(isFinallyPermanent(metaErr(803)), false, "error 803 (API timeout) is transient");

// ── Genuinely permanent config/recipient errors stay permanent ──────────────
for (const code of [131062, 131061, 131060, 400]) {
  assert.equal(isFinallyPermanent(metaErr(code)), true, `${code} is permanent`);
}

// ── Network errors are never permanent ─────────────────────────────────────
assert.equal(isNetworkSystemError({ code: "ECONNRESET" }), true);
assert.equal(isFinallyPermanent({ code: "ETIMEDOUT" }), false);

// ── classifyMetaError() categories (FIX 6 / FIX 7) ─────────────────────────
const cat = (e) => classifyMetaError(e).category;

// LOCAL_CAPACITY — its own category, NOT account restriction
const localErr = { code: "LOCAL_META_TIER_LIMIT", meta_local_capacity: true };
assert.equal(cat(localErr), "LOCAL_CAPACITY");
assert.equal(isLocalMetaCapacityError(localErr), true);
assert.equal(isMetaAccountRestrictionError(localErr), false, "local capacity must NOT be account restriction");
assert.equal(isFinallyPermanent(localErr), false);

// 131048 → SPAM_RESTRICTION (not LOCAL_CAPACITY, not permanent)
assert.equal(cat(metaErr(131048)), "SPAM_RESTRICTION");
assert.equal(isFinallyPermanent(metaErr(131048)), false);

// 131031 → ACCOUNT_RESTRICTION
assert.equal(cat(metaErr(131031)), "ACCOUNT_RESTRICTION");

// Throughput / pair-rate → retryable categories, never a WABA-wide pause
assert.equal(cat(metaErr(130429)), "THROUGHPUT");
assert.equal(cat(metaErr(80007)), "THROUGHPUT");
assert.equal(classifyMetaError(metaErr(130429)).retryable, true);
assert.equal(cat(metaErr(131056)), "PAIR_RATE_LIMIT");
assert.equal(classifyMetaError(metaErr(131056)).retryable, true);

// 131049 → recipient frequency (recipient-scoped, not a campaign pause)
assert.equal(cat(metaErr(131049)), "RECIPIENT_FREQUENCY");

// permanent + transient
assert.equal(cat(metaErr(131061)), "PERMANENT");
assert.equal(cat({ response: { status: 500 } }), "TRANSIENT");
assert.equal(cat({ code: "ECONNRESET" }), "TRANSIENT");
assert.equal(cat(metaErr(190)), "AUTH_CONFIG");

console.log("metaErrorClassifier tests passed");
