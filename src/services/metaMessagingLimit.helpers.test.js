/**
 * Pure-function coverage for the messaging-limit service.
 * Run: node src/services/metaMessagingLimit.helpers.test.js
 *
 * (Stateful flows — reservation locking, retry_after against real rows,
 *  concurrency — require a live DB and are covered by integration tests.)
 */
import assert from "node:assert/strict";
import {
  metaTimestampToDate,
  normalizeMetaRecipient,
} from "./metaMessagingLimit.service.js";

// ── phone normalisation (FIX 14) — one canonical form ──────────────────────
for (const p of ["+91 98765 43210", "919876543210", "91-98765-43210", "(91) 98765 43210"]) {
  assert.equal(normalizeMetaRecipient(p), "919876543210", `normalise ${p}`);
}
assert.equal(normalizeMetaRecipient(null), "");
assert.equal(normalizeMetaRecipient(undefined), "");

// ── Meta status timestamp → Date (FIX 9) ──────────────────────────────────
const t1 = 1_756_720_000; // seconds
const d = metaTimestampToDate(String(t1));
assert.ok(d instanceof Date);
assert.equal(d.getTime(), t1 * 1000, "string seconds convert to ms");
assert.equal(metaTimestampToDate(t1).getTime(), t1 * 1000, "numeric seconds too");

// invalid / missing → null so caller falls back to server time
for (const bad of [null, undefined, "", "abc", 0, -5, 999_999_999_999_999]) {
  assert.equal(metaTimestampToDate(bad), null, `reject ${bad}`);
}

console.log("metaMessagingLimit helper tests passed");
