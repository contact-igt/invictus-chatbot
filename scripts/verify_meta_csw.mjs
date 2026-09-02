/** BUG-1 / Phase 3 regression — customer-service-window. Stage DB, synthetic tenant, cleaned up. */
import { randomUUID } from "crypto";
import db from "../src/database/index.js";
import {
  hasOpenCustomerServiceWindow,
  reserveMetaMessagingRecipient,
  normalizeMetaRecipient,
} from "../src/services/metaMessagingLimit.service.js";

const M = "CSW_" + randomUUID().slice(0, 8);
const T = `${M}_T`, W = `${M}_W`, P = `${M}_P`;
let pass = 0, fail = 0;
const chk = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };
const inbound = (cc, phone, ageMs) =>
  db.sequelize.query(
    `INSERT INTO messages (tenant_id, phone, country_code, sender, message_type, message, status, created_at)
     VALUES (:t,:p,:cc,'user','text','a','delivered', :c)`,
    { replacements: { t: T, p: phone, cc, c: new Date(Date.now() - ageMs) } },
  );
const cleanup = async () => {
  await db.sequelize.query(`DELETE FROM messages WHERE tenant_id=:t`, { replacements: { t: T } });
  await db.sequelize.query(`DELETE FROM meta_messaging_limit_events WHERE waba_id LIKE :m`, { replacements: { m: `${M}%` } });
};
const acct = { waba_id: W, phone_number_id: P, tier: "TIER_2K" };

const run = async () => {
  // Test 1 — no inbound → false, no throw, reservation created
  let threw = false, res1;
  try { res1 = await hasOpenCustomerServiceWindow(T, "911111100001"); } catch (e) { threw = true; }
  chk("T1 no inbound → returns false, does NOT throw", threw === false && res1 === false, `threw=${threw} res=${res1}`);
  const r1 = await reserveMetaMessagingRecipient({ account: acct, tenantId: T, recipient: "911111100001", templateName: "t" });
  chk("T1b business-initiated send with no CS window → reservation created", typeof r1 === "string");

  // Test 2 — recent inbound (2h) → true, reservation skipped
  await inbound("91", "1111100002", 2 * 3600e3);
  const res2 = await hasOpenCustomerServiceWindow(T, "911111100002");
  chk("T2 recent inbound (-2h) → returns true", res2 === true);
  const r2 = await reserveMetaMessagingRecipient({ account: acct, tenantId: T, recipient: "911111100002", templateName: "t" });
  chk("T2b open CS window → reservation NOT created (null)", r2 === null);

  // Test 3 — old inbound (26h) → false, reservation created
  await inbound("91", "1111100003", 26 * 3600e3);
  const res3 = await hasOpenCustomerServiceWindow(T, "911111100003");
  chk("T3 stale inbound (-26h) → returns false", res3 === false);
  const r3 = await reserveMetaMessagingRecipient({ account: acct, tenantId: T, recipient: "911111100003", templateName: "t" });
  chk("T3b stale CS window → reservation created", typeof r3 === "string");

  // Test 4 — different stored formatting, same number
  await inbound("+91", "98765 4.32-10", 1 * 3600e3);   // stored messy, digits = 919876543210
  for (const fmt of ["+91 98765 43210", "919876543210", "91-98765-43210", "(91) 98765 43210", "91.98765.43210"]) {
    const norm = normalizeMetaRecipient(fmt);
    const hit = await hasOpenCustomerServiceWindow(T, norm);
    chk(`T4 recipient "${fmt}" (→${norm}) matches messy stored inbound`, hit === true);
  }
  // negative: a different number must NOT match
  const noHit = await hasOpenCustomerServiceWindow(T, "910000000000");
  chk("T4b unrelated number → false", noHit === false);

  console.log(`\nRESULT csw: ${pass} pass, ${fail} fail`);
};
run().catch((e) => { fail++; console.error("SCRIPT ERROR", e.stack || e.message); })
  .finally(async () => { try { await cleanup(); console.log("cleanup OK"); } catch (e) { console.error("CLEANUP FAIL " + M, e.message); } await db.sequelize.close(); process.exit(fail > 0 ? 1 : 0); });
