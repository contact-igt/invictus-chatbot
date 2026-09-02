/**
 * Phase 13–16 + 12 — pause/resume + async-webhook + WAMID-race at the SERVICE
 * level against Stage DB. Redis is unavailable here, so BullMQ dispatch is NOT
 * exercised — the DB state machine and correlation logic are.
 *
 * Synthetic tenant/campaign/WABA, cleaned up in finally.
 */
import { randomUUID } from "crypto";
import db from "../src/database/index.js";
import {
  pauseCampaignsForMetaError,
  resumeLocalCapacityPausedCampaigns,
  handleAsyncMetaFailure,
  PAUSE_TYPES,
} from "../src/models/WhatsappCampaignModel/campaignPauseControl.service.js";
import {
  applyMetaDeliveryToLimitEvent,
  retryUnmatchedStatusEvents,
  computeLocalCapacityRetryAfter,
} from "../src/services/metaMessagingLimit.service.js";

const M = "PR_" + randomUUID().slice(0, 8);
const T = `${M}_TEN`, W = `${M}_WABA`, PNID = `${M}_PN`;
let pass = 0, fail = 0;
const chk = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };
const q = (s, r = {}) => db.sequelize.query(s, { replacements: r, type: db.sequelize.QueryTypes.SELECT });

const mkCampaign = async (id, status = "active") =>
  db.sequelize.query(
    `INSERT INTO whatsapp_campaigns (campaign_id, tenant_id, campaign_name, campaign_type, template_id, status, is_deleted, created_at, updated_at)
     VALUES (:id,:t,:n,'instant',:tpl,:st,0,NOW(),NOW())`,
    { replacements: { id, t: T, n: "audit " + id, tpl: `${M}_TPL`, st: status } },
  );
const mkRecipient = (cid, phone, status = "pending") =>
  db.sequelize.query(
    `INSERT INTO whatsapp_campaign_recipients (campaign_id, mobile_number, status, is_deleted, created_at, updated_at)
     VALUES (:c,:m,:s,0,NOW(),NOW())`,
    { replacements: { c: cid, m: phone, s: status } },
  );
const seedLedger = (phone, status, sentAgoMs) =>
  db.sequelize.query(
    `INSERT INTO meta_messaging_limit_events
       (reservation_id, tenant_id, waba_id, phone_number_id, recipient_phone, template_name, status, qualifies, sent_at, created_at, updated_at)
     VALUES (:r,:t,:w,:p,:rp,'a',:st,1,:sa,NOW(),NOW())`,
    { replacements: { r: randomUUID(), t: T, w: W, p: PNID, rp: phone, st: status, sa: new Date(Date.now() - sentAgoMs) } },
  );

const cleanup = async () => {
  await db.sequelize.query(`DELETE r FROM whatsapp_campaign_recipients r JOIN whatsapp_campaigns c ON c.campaign_id=r.campaign_id WHERE c.tenant_id=:t`, { replacements: { t: T } });
  await db.sequelize.query(`DELETE FROM whatsapp_campaigns WHERE tenant_id=:t`, { replacements: { t: T } });
  await db.sequelize.query(`DELETE FROM meta_messaging_limit_events WHERE waba_id=:w`, { replacements: { w: W } });
  await db.sequelize.query(`DELETE FROM meta_unmatched_status_events WHERE wamid LIKE :m`, { replacements: { m: `${M}%` } });
  await db.sequelize.query(`DELETE FROM whatsapp_accounts WHERE waba_id=:w`, { replacements: { w: W } });
};

const run = async () => {
  await db.sequelize.query(
    `INSERT INTO whatsapp_accounts (tenant_id, whatsapp_number, phone_number_id, waba_id, status, tier, quality, is_deleted, created_at, updated_at)
     VALUES (:t,'AUDITNUM',:p,:w,'active','TIER_50','GREEN',0,NOW(),NOW())`,
    { replacements: { t: T, p: PNID, w: W } },
  );

  // ────────── PHASE 13: LOCAL_CAPACITY pause ──────────
  const C1 = `${M}_C1`;
  await mkCampaign(C1, "active");
  await mkRecipient(C1, "919000000001", "pending");
  // fill local WABA to 50/50
  for (let i = 0; i < 50; i++) await seedLedger(`9150${String(i).padStart(6, "0")}`, "sent", 1000e3);
  const retryAfter = await computeLocalCapacityRetryAfter(W);
  const localErr = { code: "LOCAL_META_TIER_LIMIT", meta_local_capacity: true, retry_after: retryAfter, message: "local cap" };
  const pr = await pauseCampaignsForMetaError({ tenantId: T, error: localErr, campaignId: C1, account: { waba_id: W, tier: "TIER_50" } });
  let c1 = (await q(`SELECT status, pause_type, pause_code, paused_at, next_retry_at FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C1 }))[0];
  chk("P13 campaign paused, pause_type=META_LOCAL_CAPACITY, pause_code, paused_at, next_retry_at set",
    c1.status === "paused" && c1.pause_type === "META_LOCAL_CAPACITY" && c1.pause_code === "LOCAL_META_TIER_LIMIT" && c1.paused_at && c1.next_retry_at,
    JSON.stringify(c1));
  chk("P13b next_retry_at is in the future", new Date(c1.next_retry_at).getTime() > Date.now());
  const rec1 = (await q(`SELECT status FROM whatsapp_campaign_recipients WHERE campaign_id=:c`, { c: C1 }))[0];
  chk("P13c recipient still 'pending' (resumable, NOT permanently_failed)", rec1.status === "pending");

  // ────────── PHASE 14: capacity still full → stays paused, next_retry_at pushed ──────────
  await db.sequelize.query(`UPDATE whatsapp_campaigns SET next_retry_at = :past WHERE campaign_id=:c`, { replacements: { past: new Date(Date.now() - 60e3), c: C1 } });
  const before14 = (await q(`SELECT next_retry_at FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C1 }))[0].next_retry_at;
  const react14 = await resumeLocalCapacityPausedCampaigns();
  c1 = (await q(`SELECT status, next_retry_at FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C1 }))[0];
  chk("P14 capacity still full → campaign stays paused", c1.status === "paused" && !react14.find((r) => r.campaign_id === C1));
  chk("P14b next_retry_at recalculated forward", new Date(c1.next_retry_at).getTime() > new Date(before14).getTime());

  // ────────── PHASE 13 cont: capacity frees → resume ──────────
  await db.sequelize.query(`DELETE FROM meta_messaging_limit_events WHERE waba_id=:w`, { replacements: { w: W } });   // capacity now 0/50
  await db.sequelize.query(`UPDATE whatsapp_campaigns SET next_retry_at = :past WHERE campaign_id=:c`, { replacements: { past: new Date(Date.now() - 60e3), c: C1 } });
  const react = await resumeLocalCapacityPausedCampaigns();
  c1 = (await q(`SELECT status, pause_type, next_retry_at FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C1 }))[0];
  chk("P13d capacity freed → campaign status=active, pause metadata cleared",
    c1.status === "active" && c1.pause_type === null && c1.next_retry_at === null && react.some((r) => r.campaign_id === C1),
    JSON.stringify(c1));

  // ────────── PHASE 13: idempotent resume (concurrent) ──────────
  const C2 = `${M}_C2`;
  await mkCampaign(C2, "paused");
  await db.sequelize.query(`UPDATE whatsapp_campaigns SET pause_type='META_LOCAL_CAPACITY', pause_code='LOCAL_META_TIER_LIMIT', paused_at=NOW(), next_retry_at=:p WHERE campaign_id=:c`, { replacements: { p: new Date(Date.now() - 60e3), c: C2 } });
  await mkRecipient(C2, "919000000002", "pending");
  const [rA, rB] = await Promise.all([resumeLocalCapacityPausedCampaigns(), resumeLocalCapacityPausedCampaigns()]);
  const activatedCount = [...rA, ...rB].filter((r) => r.campaign_id === C2).length;
  const c2 = (await q(`SELECT status FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C2 }))[0];
  chk("P13e concurrent resume → campaign activated exactly ONCE", c2.status === "active" && activatedCount === 1, `activatedCount=${activatedCount}`);

  // ────────── PHASE 15: MANUAL pause never auto-resumed ──────────
  const C3 = `${M}_C3`;
  await mkCampaign(C3, "paused");
  await db.sequelize.query(`UPDATE whatsapp_campaigns SET pause_type='MANUAL', paused_at=NOW() WHERE campaign_id=:c`, { replacements: { c: C3 } });
  await resumeLocalCapacityPausedCampaigns();
  const c3 = (await q(`SELECT status, pause_type FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C3 }))[0];
  chk("P15 MANUAL pause → NOT resumed by capacity scheduler", c3.status === "paused" && c3.pause_type === "MANUAL");

  // ────────── PHASE 16: async failed webhook → classifier → pause ──────────
  const cases = [
    { code: 131048, expect: "META_SPAM_RESTRICTION" },
    { code: 131031, expect: "META_ACCOUNT_RESTRICTION" },
    { code: 130429, expect: null },   // THROUGHPUT → no campaign pause
    { code: 131056, expect: null },   // PAIR_RATE_LIMIT → no campaign pause
  ];
  for (const cs of cases) {
    const cid = `${M}_W${cs.code}`;
    await mkCampaign(cid, "active");
    await mkRecipient(cid, "919000009999", "sent");
    await handleAsyncMetaFailure({ tenantId: T, campaignId: cid, metaErrors: [{ code: cs.code }] });
    const row = (await q(`SELECT status, pause_type FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: cid }))[0];
    if (cs.expect) {
      chk(`P16 async failed ${cs.code} → campaign paused pause_type=${cs.expect}`, row.status === "paused" && row.pause_type === cs.expect, JSON.stringify(row));
    } else {
      chk(`P16 async failed ${cs.code} → campaign NOT paused (recipient-scoped)`, row.status === "active" && row.pause_type === null, JSON.stringify(row));
    }
  }

  // ────────── PHASE 12: WAMID race — webhook before ledger row ──────────
  const raceWamid = `${M}_RACE1`;
  await applyMetaDeliveryToLimitEvent(raceWamid, "delivered", new Date(Date.now() - 5000), { payload: { id: raceWamid, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000) - 5) } });
  let unm = (await q(`SELECT wamid, status, retry_count, resolved_at FROM meta_unmatched_status_events WHERE wamid=:w`, { w: raceWamid }))[0];
  chk("P12 webhook with no ledger row → persisted to meta_unmatched_status_events", unm && unm.status === "delivered" && unm.resolved_at === null);
  // now the ledger row appears (send confirms late)
  await seedLedger("919000000077", "sent", 1000);
  await db.sequelize.query(`UPDATE meta_messaging_limit_events SET wamid=:w WHERE recipient_phone='919000000077'`, { replacements: { w: raceWamid } });
  // force retry now
  await db.sequelize.query(`UPDATE meta_unmatched_status_events SET next_retry_at = :p WHERE wamid=:w`, { replacements: { p: new Date(Date.now() - 1000), w: raceWamid } });
  await retryUnmatchedStatusEvents();
  unm = (await q(`SELECT resolved_at FROM meta_unmatched_status_events WHERE wamid=:w`, { w: raceWamid }))[0];
  const led = (await q(`SELECT status, delivered_at FROM meta_messaging_limit_events WHERE wamid=:w`, { w: raceWamid }))[0];
  chk("P12b after correlation appears → retry marks unmatched RESOLVED", unm.resolved_at !== null);
  chk("P12c ledger row now status=delivered with delivered_at", led.status === "delivered" && led.delivered_at, JSON.stringify(led));
  // bounded: an unmatched event that never correlates stops after MAX retries
  const orphan = `${M}_ORPHAN`;
  await applyMetaDeliveryToLimitEvent(orphan, "delivered", null, { payload: { id: orphan } });
  for (let i = 0; i < 7; i++) {
    await db.sequelize.query(`UPDATE meta_unmatched_status_events SET next_retry_at = :p WHERE wamid=:w`, { replacements: { p: new Date(Date.now() - 1000), w: orphan } });
    await retryUnmatchedStatusEvents();
  }
  const orphanRow = (await q(`SELECT retry_count, resolved_at FROM meta_unmatched_status_events WHERE wamid=:w`, { w: orphan }))[0];
  chk("P12d orphan (never correlates) → retry_count capped at 5, not resolved, no infinite loop", Number(orphanRow.retry_count) === 5 && orphanRow.resolved_at === null, JSON.stringify(orphanRow));

  console.log(`\nRESULT pause/resume/webhook: ${pass} pass, ${fail} fail`);
};
run().catch((e) => { fail++; console.error("SCRIPT ERROR", e.stack || e.message); })
  .finally(async () => { try { await cleanup(); console.log("cleanup OK"); } catch (e) { console.error("CLEANUP FAIL " + M, e.message); } await db.sequelize.close(); process.exit(fail > 0 ? 1 : 0); });
