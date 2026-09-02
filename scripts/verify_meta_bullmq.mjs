/**
 * FINAL GATE — Meta LOCAL_CAPACITY resume → BullMQ dispatch → send-job creation.
 *
 * Requires a REACHABLE Redis (`REDIS_URL`). Run against Stage:
 *     REDIS_URL=redis://<stage-redis-host>:6379 node scripts/verify_meta_bullmq.mjs
 *
 * It exercises the real queue orchestration (dispatch queue + dispatch worker)
 * but NOT the send worker, so **no Meta API calls are made**. All synthetic data
 * is prefixed AUDIT_META_REDIS_ and hard-deleted; test jobs are obliterated.
 */
import { randomUUID } from "crypto";
import db from "../src/database/index.js";
import {
  initCampaignQueues,
  closeCampaignQueues,
  isCampaignQueueAvailable,
  getCampaignDispatchQueue,
  getTenantQueue,
  getTenantQueueName,
  getCampaignDispatchQueueName,
} from "../src/queues/campaignQueue.js";
import {
  startCampaignDispatchWorker,
  closeDispatchWorker,
} from "../src/workers/campaignDispatchWorker.js";
import { enqueueCampaignDispatch } from "../src/models/WhatsappCampaignModel/whatsappcampaign.service.js";
import {
  resumeLocalCapacityPausedCampaigns,
  pauseCampaignsForMetaError,
} from "../src/models/WhatsappCampaignModel/campaignPauseControl.service.js";
import { computeLocalCapacityRetryAfter, checkLocalWabaCapacity } from "../src/services/metaMessagingLimit.service.js";

const M = "AUDIT_META_REDIS_" + randomUUID().slice(0, 6);
const T = `${M}_TEN`, W = `${M}_WABA`, PN = `${M}_PN`, TPL = `${M}_TPL`;
let pass = 0, fail = 0;
const chk = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };
const q = (s, r = {}) => db.sequelize.query(s, { replacements: r, type: db.sequelize.QueryTypes.SELECT });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mkCampaign = (id, status = "active") =>
  db.sequelize.query(
    `INSERT INTO whatsapp_campaigns (campaign_id, tenant_id, campaign_name, campaign_type, template_id, status, is_deleted, created_at, updated_at)
     VALUES (:id,:t,:n,'immediate',:tpl,:st,0,NOW(),NOW())`,
    { replacements: { id, t: T, n: id, tpl: TPL, st: status } });
const mkRecipient = (cid, phone, status = "pending") =>
  db.sequelize.query(
    `INSERT INTO whatsapp_campaign_recipients (campaign_id, mobile_number, status, is_deleted, created_at, updated_at)
     VALUES (:c,:m,:s,0,NOW(),NOW())`,
    { replacements: { c: cid, m: phone, s: status } });
const seedLedger = (phone) =>
  db.sequelize.query(
    `INSERT INTO meta_messaging_limit_events (reservation_id,tenant_id,waba_id,phone_number_id,recipient_phone,template_name,status,qualifies,sent_at,created_at,updated_at)
     VALUES (:r,:t,:w,:p,:rp,'a','sent',1,:sa,NOW(),NOW())`,
    { replacements: { r: randomUUID(), t: T, w: W, p: PN, rp: phone.replace(/\D/g, ""), sa: new Date(Date.now() - 1000e3) } });

const dispatchJobs = async () => {
  const dq = getCampaignDispatchQueue();
  const jobs = await dq.getJobs(["waiting", "delayed", "active", "completed", "failed", "paused"]);
  return jobs.filter((j) => String(j.data?.tenant_id || "") === T);
};
const sendJobs = async () => {
  const sq = getTenantQueue(T);
  const jobs = await sq.getJobs(["waiting", "delayed", "active", "completed", "failed", "paused"]);
  return jobs;
};

const cleanup = async () => {
  try {
    const dq = getCampaignDispatchQueue();
    if (dq) for (const j of await dispatchJobs()) { try { await j.remove(); } catch {} }
    const sq = getTenantQueue(T);
    if (sq) { try { await sq.obliterate({ force: true }); } catch {} }
  } catch {}
  await db.sequelize.query(`DELETE r FROM whatsapp_campaign_recipients r JOIN whatsapp_campaigns c ON c.campaign_id=r.campaign_id WHERE c.tenant_id=:t`, { replacements: { t: T } });
  await db.sequelize.query(`DELETE FROM whatsapp_campaigns WHERE tenant_id=:t`, { replacements: { t: T } });
  await db.sequelize.query(`DELETE FROM meta_messaging_limit_events WHERE waba_id=:w`, { replacements: { w: W } });
  await db.sequelize.query(`DELETE FROM meta_unmatched_status_events WHERE wamid LIKE :m`, { replacements: { m: `${M}%` } });
  await db.sequelize.query(`DELETE FROM whatsapp_accounts WHERE waba_id=:w`, { replacements: { w: W } });
  await db.sequelize.query(`DELETE FROM wallets WHERE tenant_id=:t`, { replacements: { t: T } });
  await db.sequelize.query(`DELETE FROM wallet_transactions WHERE tenant_id=:t`, { replacements: { t: T } }).catch(() => {});
};

const run = async () => {
  // ── PHASE 1 ──────────────────────────────────────────────────────────
  await initCampaignQueues();
  chk("P1 Redis / campaign queue available", isCampaignQueueAvailable());
  if (!isCampaignQueueAvailable()) throw new Error("Redis unavailable — cannot run the BullMQ gate");
  startCampaignDispatchWorker();
  chk("P1 dispatch worker started", true);
  console.log(`    dispatch queue = ${getCampaignDispatchQueueName()}   send queue = ${getTenantQueueName(T)}`);

  await db.sequelize.query(
    `INSERT INTO whatsapp_accounts (tenant_id,whatsapp_number,phone_number_id,waba_id,status,tier,quality,is_deleted,created_at,updated_at)
     VALUES (:t,'AUDITNUM',:p,:w,'active','TIER_50','GREEN',0,NOW(),NOW())`,
    { replacements: { t: T, p: PN, w: W } });
  // Wallet so the dispatch worker's billing reservation passes (unrelated to the tier guard).
  await db.sequelize.query(
    `INSERT INTO wallets (tenant_id, balance, currency, created_at, updated_at)
     VALUES (:t, 100000.0000, 'INR', NOW(), NOW())`,
    { replacements: { t: T } });

  // ── PHASE 5: capacity 50/50 ──────────────────────────────────────────
  for (let i = 0; i < 50; i++) await seedLedger(`9150${String(i).padStart(6, "0")}`);
  const cap = await checkLocalWabaCapacity({ waba_id: W, tier: "TIER_50" });
  chk("P5 checkLocalWabaCapacity 50/50 → hasCapacity=false", cap.used === 50 && !cap.hasCapacity);
  chk("P5 computeLocalCapacityRetryAfter → future", (await computeLocalCapacityRetryAfter(W)).getTime() > Date.now());

  // ── PHASE 6: pause ──────────────────────────────────────────────────
  const C1 = `${M}_C1`;
  await mkCampaign(C1, "active");
  await Promise.all([mkRecipient(C1, "919000000001"), mkRecipient(C1, "919000000002"), mkRecipient(C1, "919000000003")]);
  const retryAfter = await computeLocalCapacityRetryAfter(W);
  await pauseCampaignsForMetaError({
    tenantId: T, campaignId: C1,
    error: { code: "LOCAL_META_TIER_LIMIT", meta_local_capacity: true, retry_after: retryAfter, message: "cap" },
  });
  let c1 = (await q(`SELECT status,pause_type,pause_code,paused_at,next_retry_at FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C1 }))[0];
  chk("P6 campaign paused with structured metadata", c1.status === "paused" && c1.pause_type === "META_LOCAL_CAPACITY" && c1.pause_code === "LOCAL_META_TIER_LIMIT" && c1.paused_at && c1.next_retry_at, JSON.stringify(c1));
  chk("P6 recipients still pending", (await q(`SELECT COUNT(*) c FROM whatsapp_campaign_recipients WHERE campaign_id=:c AND status='pending'`, { c: C1 }))[0].c == 3);

  // ── PHASE 7: capacity still full → stays paused, NO dispatch job ─────
  await db.sequelize.query(`UPDATE whatsapp_campaigns SET next_retry_at=:p WHERE campaign_id=:c`, { replacements: { p: new Date(Date.now() - 60e3), c: C1 } });
  let resumed = await resumeLocalCapacityPausedCampaigns();
  for (const c of resumed) await enqueueCampaignDispatch(c.campaign_id, c.tenant_id);
  await sleep(500);
  c1 = (await q(`SELECT status,next_retry_at FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C1 }))[0];
  chk("P7 capacity full → campaign stays paused", c1.status === "paused" && !resumed.find((r) => r.campaign_id === C1));
  chk("P7 NO dispatch job in BullMQ", (await dispatchJobs()).length === 0);
  chk("P7 NO send jobs", (await sendJobs()).length === 0);

  // ── PHASE 8/9/10: free capacity → resume → real dispatch → send jobs ─
  await db.sequelize.query(`DELETE FROM meta_messaging_limit_events WHERE waba_id=:w`, { replacements: { w: W } });   // 0/50
  await db.sequelize.query(`UPDATE whatsapp_campaigns SET next_retry_at=:p WHERE campaign_id=:c`, { replacements: { p: new Date(Date.now() - 60e3), c: C1 } });
  resumed = await resumeLocalCapacityPausedCampaigns();
  chk("P8 freed capacity → resume returns campaign", resumed.some((r) => r.campaign_id === C1));
  for (const c of resumed) await enqueueCampaignDispatch(c.campaign_id, c.tenant_id);
  c1 = (await q(`SELECT status,pause_type,next_retry_at FROM whatsapp_campaigns WHERE campaign_id=:c`, { c: C1 }))[0];
  chk("P8 campaign status=active, pause metadata cleared", c1.status === "active" && c1.pause_type === null && c1.next_retry_at === null, JSON.stringify(c1));

  const dj = await dispatchJobs();
  chk("P9 exactly ONE campaign-dispatch job in BullMQ", dj.length === 1, `jobId=${dj[0]?.id} data=${JSON.stringify(dj[0]?.data)}`);
  chk("P9 dispatch jobId = dispatch:{campaign_id}:0", dj[0]?.id === `dispatch:${C1}:0`);

  // let the dispatch worker process it
  for (let i = 0; i < 20 && (await sendJobs()).length < 3; i++) await sleep(500);
  let sj = await sendJobs();
  chk("P10 dispatch worker created exactly 3 send jobs (one per pending recipient)", sj.length === 3, `${sj.map((j) => j.id).join(", ")}`);
  chk("P10 send jobIds = send:{campaign_id}:{recipient_id}", sj.every((j) => /^send:.+:\d+$/.test(j.id)));
  const recIds = (await q(`SELECT id FROM whatsapp_campaign_recipients WHERE campaign_id=:c`, { c: C1 })).map((r) => `send:${C1}:${r.id}`);
  chk("P10 send jobIds map 1:1 to pending recipient rows", new Set(sj.map((j) => j.id)).size === 3 && recIds.every((id) => sj.some((j) => j.id === id)));

  // ── PHASE 11: duplicate scheduler execution ────────────────────────
  // hard re-pause C1 as META_LOCAL_CAPACITY, free capacity, then resume TWICE concurrently
  await db.sequelize.query(
    `UPDATE whatsapp_campaigns
        SET status='paused', pause_type='META_LOCAL_CAPACITY', pause_code='LOCAL_META_TIER_LIMIT',
            paused_at=NOW(), next_retry_at=:p
      WHERE campaign_id=:c`,
    { replacements: { p: new Date(Date.now() - 60e3), c: C1 } });
  for (const j of await dispatchJobs()) { try { await j.remove(); } catch {} }
  const [r1, r2] = await Promise.all([resumeLocalCapacityPausedCampaigns(), resumeLocalCapacityPausedCampaigns()]);
  const activations = [...r1, ...r2].filter((r) => r.campaign_id === C1).length;
  for (const c of [...r1, ...r2]) await enqueueCampaignDispatch(c.campaign_id, c.tenant_id);
  await sleep(400);
  chk("P11 concurrent resume → campaign activated exactly ONCE", activations === 1, `activations=${activations}`);
  chk("P11 exactly ONE dispatch job", (await dispatchJobs()).length === 1);
  for (let i = 0; i < 16 && (await sendJobs()).length < 3; i++) await sleep(500);
  sj = await sendJobs();
  const uniqueSendIds = new Set(sj.map((j) => j.id));
  chk("P11 send jobs deduped — exactly 3 unique (no duplicate recipient sends)", uniqueSendIds.size === 3, `count=${sj.length} unique=${uniqueSendIds.size}`);

  // ── PHASE 12: non-pending recipient protection ─────────────────────
  const C2 = `${M}_C2`;
  await mkCampaign(C2, "paused");
  await db.sequelize.query(`UPDATE whatsapp_campaigns SET pause_type='META_LOCAL_CAPACITY', pause_code='LOCAL_META_TIER_LIMIT', paused_at=NOW(), next_retry_at=:p WHERE campaign_id=:c`, { replacements: { p: new Date(Date.now() - 60e3), c: C2 } });
  await mkRecipient(C2, "919000001001", "pending");
  await mkRecipient(C2, "919000001002", "sent");
  await mkRecipient(C2, "919000001003", "delivered");
  await mkRecipient(C2, "919000001004", "read");
  await mkRecipient(C2, "919000001005", "permanently_failed");
  const before = (await sendJobs()).length;
  const r3 = await resumeLocalCapacityPausedCampaigns();
  for (const c of r3) await enqueueCampaignDispatch(c.campaign_id, c.tenant_id);
  for (let i = 0; i < 16 && (await sendJobs()).length <= before; i++) await sleep(500);
  const newSend = (await sendJobs()).filter((j) => j.id.startsWith(`send:${C2}:`));
  const pendingRid = (await q(`SELECT id FROM whatsapp_campaign_recipients WHERE campaign_id=:c AND status='pending'`, { c: C2 }))[0].id;
  chk("P12 only the ONE pending recipient got a send job (sent/delivered/read/permanently_failed skipped)",
    newSend.length === 1 && newSend[0].id === `send:${C2}:${pendingRid}`, `${newSend.map((j) => j.id).join(", ")}`);

  // ── PHASE 13/14: MANUAL / SPAM / ACCOUNT pauses not capacity-resumed ─
  for (const [suffix, ptype] of [["M", "MANUAL"], ["S", "META_SPAM_RESTRICTION"], ["A", "META_ACCOUNT_RESTRICTION"]]) {
    const cid = `${M}_P${suffix}`;
    await mkCampaign(cid, "paused");
    await db.sequelize.query(`UPDATE whatsapp_campaigns SET pause_type=:pt, paused_at=NOW(), next_retry_at=:p WHERE campaign_id=:c`, { replacements: { pt: ptype, p: new Date(Date.now() - 60e3), c: cid } });
    await mkRecipient(cid, `9190000020${suffix.charCodeAt(0)}`, "pending");
  }
  const djBefore = (await dispatchJobs()).map((j) => j.id).sort().join(",");
  const r4 = await resumeLocalCapacityPausedCampaigns();
  for (const c of r4) await enqueueCampaignDispatch(c.campaign_id, c.tenant_id);
  await sleep(400);
  const paused3 = (await q(`SELECT campaign_id,status FROM whatsapp_campaigns WHERE campaign_id IN (:m,:s,:a)`, { m: `${M}_PM`, s: `${M}_PS`, a: `${M}_PA` }));
  chk("P13/14 MANUAL + SPAM + ACCOUNT pauses all stay 'paused'", paused3.every((r) => r.status === "paused"));
  chk("P13/14 none returned by resume, no new dispatch jobs", !r4.some((r) => [`${M}_PM`, `${M}_PS`, `${M}_PA`].includes(r.campaign_id)) && (await dispatchJobs()).map((j) => j.id).sort().join(",") === djBefore);

  console.log(`\nRESULT bullmq: ${pass} pass, ${fail} fail`);
};

run().catch((e) => { fail++; console.error("SCRIPT ERROR", e.stack || e.message); })
  .finally(async () => {
    try { await cleanup(); console.log("cleanup OK"); } catch (e) { console.error("CLEANUP FAIL " + M, e.message); }
    try { await closeDispatchWorker(); await closeCampaignQueues(); } catch {}
    await db.sequelize.close();
    process.exit(fail > 0 ? 1 : 0);
  });
