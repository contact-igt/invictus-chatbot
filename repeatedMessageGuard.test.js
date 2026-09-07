import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRepeatedMessage,
  hashRepeatedMessage,
  isQualifyingInboundText,
} from "./src/services/repeatedMessageGuard.service.js";
import {
  REPEATED_MESSAGE_THRESHOLD,
  REPEATED_MESSAGE_WINDOW_MINUTES,
  REPEATED_MESSAGE_HANDOFF_TEXT,
  isRepeatedMessageHandoffEnabled,
} from "./src/config/repeatedMessageHandoff.config.js";

test("constants match the product spec", () => {
  assert.equal(REPEATED_MESSAGE_THRESHOLD, 5);
  assert.equal(REPEATED_MESSAGE_WINDOW_MINUTES, 10);
  assert.match(REPEATED_MESSAGE_HANDOFF_TEXT, /connecting you with our team/i);
});

// Test 5 — case / spacing normalization
test("normalization treats case and whitespace variants as equal", () => {
  const variants = ["Hello", " hello ", "HELLO", "Hello   ", "hello\t\nhello".replace("\t\nhello", "")];
  const base = normalizeRepeatedMessage("Hello");
  for (const v of ["Hello", " hello ", "HELLO", "Hello   "]) {
    assert.equal(normalizeRepeatedMessage(v), base, `variant ${JSON.stringify(v)}`);
  }
  assert.equal(base, "hello");
  void variants;
});

test("internal whitespace runs collapse to a single space", () => {
  assert.equal(normalizeRepeatedMessage("appointment    now"), "appointment now");
});

// Test 6 — punctuation is significant
test("punctuation differences are NOT equal", () => {
  assert.notEqual(
    normalizeRepeatedMessage("hello"),
    normalizeRepeatedMessage("hello!"),
  );
});

test("trailing digits are significant (appointment 1 != appointment 2)", () => {
  assert.notEqual(
    hashRepeatedMessage(normalizeRepeatedMessage("appointment 1")),
    hashRepeatedMessage(normalizeRepeatedMessage("appointment 2")),
  );
});

test("emoji are preserved", () => {
  assert.equal(normalizeRepeatedMessage("Book 📅"), "book 📅");
});

test("NFKC folds compatibility characters", () => {
  // Fullwidth 'ＡＢＣ' → 'abc'
  assert.equal(normalizeRepeatedMessage("ＡＢＣ"), "abc");
});

test("hash is deterministic and hex sha-256", () => {
  const h1 = hashRepeatedMessage("hello");
  const h2 = hashRepeatedMessage("hello");
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

// Test 7 / §9 — what counts
test("only non-empty inbound text qualifies", () => {
  assert.equal(isQualifyingInboundText({ messageType: "text", text: "hi" }), true);
  assert.equal(isQualifyingInboundText({ messageType: "text", text: "   " }), false);
  assert.equal(isQualifyingInboundText({ messageType: "text", text: "" }), false);
  assert.equal(isQualifyingInboundText({ messageType: "image", text: "hi" }), false);
  assert.equal(isQualifyingInboundText({ messageType: "interactive", text: "Yes" }), false);
  assert.equal(isQualifyingInboundText({ messageType: "button", text: "Confirm" }), false);
  assert.equal(isQualifyingInboundText({ messageType: "audio", text: "" }), false);
});

// §36 — feature flag defaults OFF
test("feature flag is disabled by default and respects the tenant allowlist", () => {
  const prevEnabled = process.env.REPEATED_MESSAGE_HANDOFF_ENABLED;
  const prevTenants = process.env.REPEATED_MESSAGE_HANDOFF_TENANTS;
  delete process.env.REPEATED_MESSAGE_HANDOFF_ENABLED;
  delete process.env.REPEATED_MESSAGE_HANDOFF_TENANTS;
  assert.equal(isRepeatedMessageHandoffEnabled("TNT-1"), false);

  process.env.REPEATED_MESSAGE_HANDOFF_TENANTS = "TNT-1, TNT-9";
  assert.equal(isRepeatedMessageHandoffEnabled("TNT-1"), true);
  assert.equal(isRepeatedMessageHandoffEnabled("TNT-2"), false);

  process.env.REPEATED_MESSAGE_HANDOFF_ENABLED = "true";
  assert.equal(isRepeatedMessageHandoffEnabled("TNT-2"), true);

  if (prevEnabled === undefined) delete process.env.REPEATED_MESSAGE_HANDOFF_ENABLED;
  else process.env.REPEATED_MESSAGE_HANDOFF_ENABLED = prevEnabled;
  if (prevTenants === undefined) delete process.env.REPEATED_MESSAGE_HANDOFF_TENANTS;
  else process.env.REPEATED_MESSAGE_HANDOFF_TENANTS = prevTenants;
});
