/** Phase 17 — core tier-limit regression after fixes. Stage DB, synthetic, cleaned up. */
import { randomUUID } from "crypto";
import db from "../src/database/index.js";
import {
  reserveMetaMessagingRecipient,
  confirmMetaMessagingReservation,
  releaseMetaMessagingReservation,
  applyMetaDeliveryToLimitEvent,
  getMetaMessagingLimitUsage,
  computeLocalCapacityRetryAfter,
  checkLocalWabaCapacity,
  normalizeMetaRecipient,
} from "../src/services/metaMessagingLimit.service.js";

const M = "REG_" + randomUUID().slice(0, 8);
const T = `${M}_T`, W = `${M}_W`, P = `${M}_P`;
let pass = 0, fail = 0;
const chk = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };
const q = (s, r = {}) => db.sequelize.query(s, { replacements: r, type: db.sequelize.QueryTypes.SELECT });
const inbound = (phone) => db.sequelize.query(
  `INSERT INTO messages (tenant_id, phone, country_code, sender, message_type, message, status, created_at) VALUES (:t,:p,'','user','text','a','delivered',NOW())`,
  { replacements: { t: T, p: normalizeMetaRecipient(phone) } });
const seed = (waba, phone, status, agoMs, deliveredAgoMs) => db.sequelize.query(
  `INSERT INTO meta_messaging_limit_events (reservation_id,tenant_id,waba_id,phone_number_id,recipient_phone,template_name,status,qualifies,sent_at,delivered_at,created_at,updated_at)
   VALUES (:r,:t,:w,:p,:rp,'a',:st,1,:sa,:da,NOW(),NOW())`,
  { replacements: { r: randomUUID(), t: T, w: waba, p: P, rp: normalizeMetaRecipient(phone), st: status, sa: new Date(Date.now() - agoMs), da: deliveredAgoMs != null ? new Date(Date.now() - deliveredAgoMs) : null } });
const uniqUsed = (waba) => q(`SELECT COUNT(DISTINCT recipient_phone) c FROM meta_messaging_limit_events WHERE waba_id=:w AND qualifies=1 AND status IN ('reserved','sent','delivered','read') AND sent_at >= :ws`, { w: waba, ws: new Date(Date.now() - 24 * 3600e3) }).then((r) => Number(r[0].c));
const cleanup = async () => {
  await db.sequelize.query(`DELETE FROM meta_messaging_limit_events WHERE waba_id LIKE :m`, { replacements: { m: `${M}%` } });
  await db.sequelize.query(`DELETE FROM messages WHERE tenant_id=:t`, { replacements: { t: T } });
  await db.sequelize.query(`DELETE FROM whatsapp_accounts WHERE waba_id LIKE :m`, { replacements: { m: `${M}%` } });
};

const run = async () => {
  await db.sequelize.query(`INSERT INTO whatsapp_accounts (tenant_id,whatsapp_number,phone_number_id,waba_id,status,tier,quality,is_deleted,created_at,updated_at) VALUES (:t,'X',:p,:w,'active','TIER_50','GREEN',0,NOW(),NOW())`, { replacements: { t: T, p: P, w: W } });
  const acct = (tier = "TIER_50") => ({ waba_id: W, phone_number_id: P, tier });
  // BUG-1 fixed → no inbound-seeding workaround needed; hasOpenCustomerServiceWindow returns false cleanly.
  const reserve = async (phone, tier) => { try { return { ok: true, r: await reserveMetaMessagingRecipient({ account: acct(tier), tenantId: T, recipient: phone, templateName: "t" }) }; } catch (e) { return { ok: false, code: e.code, err: e }; } };
  void inbound;

  // normalization
  chk("R normalization → one canonical", ["+91 98765 43210", "91-98765-43210", "(91)98765.43210"].every((p) => normalizeMetaRecipient(p) === "919876543210"));

  // dedup + rolling
  await seed(W, "911111111111", "delivered", 3600e3, 3600e3);
  await seed(W, "911111111111", "delivered", 1800e3, 1800e3);
  await seed(W, "912222222222", "read", 500e3, 500e3);
  await seed(W, "913333333333", "delivered", 400e3, 400e3);
  await seed(W, "914444444444", "delivered", 25 * 3600e3, 25 * 3600e3);
  const u = await getMetaMessagingLimitUsage(W);
  chk("R dedup + rolling24h (A x2 + B + C in window, D at -25h excluded) = 3", u.rolling24hUsed === 3, JSON.stringify(u));

  // reservation lifecycle
  const rid = await reserveMetaMessagingRecipient({ account: acct("TIER_2K"), tenantId: T, recipient: "915000000001", templateName: "welcome" });
  chk("R reserve → id", typeof rid === "string");
  await confirmMetaMessagingReservation(rid, `${M}_WAMID`);
  let row = (await q(`SELECT status,wamid FROM meta_messaging_limit_events WHERE reservation_id=:r`, { r: rid }))[0];
  chk("R confirm → sent + wamid", row.status === "sent" && row.wamid === `${M}_WAMID`);
  const t1 = new Date(Date.now() - 300e3);
  await applyMetaDeliveryToLimitEvent(`${M}_WAMID`, "delivered", t1);
  row = (await q(`SELECT status,delivered_at FROM meta_messaging_limit_events WHERE reservation_id=:r`, { r: rid }))[0];
  chk("R delivered → status + Meta timestamp", row.status === "delivered" && Math.abs(new Date(row.delivered_at) - t1) < 2000);
  await applyMetaDeliveryToLimitEvent(`${M}_WAMID`, "read", new Date());
  row = (await q(`SELECT status,delivered_at FROM meta_messaging_limit_events WHERE reservation_id=:r`, { r: rid }))[0];
  chk("R read → delivered_at unchanged", row.status === "read" && Math.abs(new Date(row.delivered_at) - t1) < 2000);
  const rid2 = await reserveMetaMessagingRecipient({ account: acct("TIER_2K"), tenantId: T, recipient: "915000000002", templateName: "t" });
  await releaseMetaMessagingReservation(rid2);
  chk("R release → deleted", Number((await q(`SELECT COUNT(*) c FROM meta_messaging_limit_events WHERE reservation_id=:r`, { r: rid2 }))[0].c) === 0);

  // full-limit rejection
  await db.sequelize.query(`DELETE FROM meta_messaging_limit_events WHERE waba_id=:w`, { replacements: { w: W } });
  for (let i = 0; i < 50; i++) await seed(W, `9150${String(i).padStart(6, "0")}`, "sent", 1000e3, null);
  const cap = await checkLocalWabaCapacity({ waba_id: W, tier: "TIER_50" });
  chk("R checkLocalWabaCapacity 50/50 → hasCapacity=false", cap.used === 50 && !cap.hasCapacity);
  const r51 = await reserve("915199999999", "TIER_50");
  chk("R recipient 51 → LOCAL_META_TIER_LIMIT, future retry_after, marker", !r51.ok && r51.code === "LOCAL_META_TIER_LIMIT" && r51.err.retry_after > new Date() && r51.err.meta_local_capacity === true && r51.err.meta_account_restriction === undefined);
  chk("R rejected → no ledger row", (await uniqUsed(W)) === 50);
  const existing = (await q(`SELECT recipient_phone FROM meta_messaging_limit_events WHERE waba_id=:w LIMIT 1`, { w: W }))[0].recipient_phone;
  const rEx = await reserve(existing, "TIER_50");
  chk("R already-counted recipient at limit → allowed", rEx.ok && typeof rEx.r === "string");

  // concurrency
  let ok = true, over = 0;
  for (let round = 0; round < 5; round++) {
    await db.sequelize.query(`DELETE FROM meta_messaging_limit_events WHERE waba_id=:w`, { replacements: { w: W } });
    for (let i = 0; i < 49; i++) await seed(W, `916${round}${String(i).padStart(6, "0")}`, "sent", 1000e3, null);
    const pX = `9171${round}00000`, pY = `9172${round}00000`;
    const [x, y] = await Promise.all([
      reserveMetaMessagingRecipient({ account: acct("TIER_50"), tenantId: T, recipient: pX, templateName: "t" }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code })),
      reserveMetaMessagingRecipient({ account: acct("TIER_50"), tenantId: T, recipient: pY, templateName: "t" }).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code })),
    ]);
    const s = [x, y].filter((z) => z.ok).length, l = [x, y].filter((z) => !z.ok && z.code === "LOCAL_META_TIER_LIMIT").length;
    if (!(s === 1 && l === 1)) ok = false;
    if ((await uniqUsed(W)) > 50) over++;
  }
  chk("R concurrency: 1 success + 1 LOCAL_META_TIER_LIMIT every round, never > 50", ok && over === 0);

  console.log(`\nRESULT regression: ${pass} pass, ${fail} fail`);
};
run().catch((e) => { fail++; console.error("SCRIPT ERROR", e.stack || e.message); })
  .finally(async () => { try { await cleanup(); console.log("cleanup OK"); } catch (e) { console.error("CLEANUP FAIL " + M, e.message); } await db.sequelize.close(); process.exit(fail > 0 ? 1 : 0); });
