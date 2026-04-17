/**
 * hardDeleteCron.js
 *
 * Master daily hard-delete job.
 * Runs at 04:00 UTC via node-cron (registered in app.js).
 *
 * ORDER: children are always deleted BEFORE parents to avoid FK violations.
 *
 * Execution order:
 *  1.  campaign_events                (leaf — child of recipients)
 *  2.  whatsapp_campaign_recipients   (child of campaigns)
 *  3.  whatsapp_campaigns             (parent — now safe to delete)
 *  4.  whatsapp_template_sync_logs    (leaf — child of templates)
 *  5.  whatsapp_template_variables    (leaf — child of templates)
 *  6.  whatsapp_templates_components  (leaf — child of templates)
 *  7.  whatsapp_templates             (parent — now safe to delete)
 *  8.  knowledge_chunks               (leaf — child of sources)
 *      NOTE: chunks are already hard-deleted on source soft-delete.
 *            This step catches any orphaned chunks.
 *  9.  faq_knowledge_source           (leaf — child of faq_reviews)
 * 10.  faq_reviews                    (parent — now safe to delete)
 * 11.  knowledge_sources              (parent — chunks already gone)
 * 12.  media_assets                   (R2 file purge + DB delete)
 * 13.  contact_group_members          (leaf — already hard-deleted on contact soft-delete)
 * 14.  booking_sessions               (leaf — child of appointments/contacts)
 * 15.  messages                       (leaf — child of contacts)
 * 16.  live_chats                     (leaf — child of contacts)
 * 17.  leads                          (child of contacts)
 * 18.  appointments                   (child of contacts/doctors)
 * 19.  contacts                       (parent — all children gone)
 * 20.  contact_groups                 (standalone after members deleted)
 * 21.  doctor_specializations         (leaf — join table)
 * 22.  doctor_availability            (leaf — child of doctors)
 * 23.  doctors                        (parent — children gone)
 * 24.  specializations                (parent — doctor_specializations gone)
 * 25.  ai_prompts                     (standalone)
 *
 * SYSTEM CLEANUP (not lifecycle — separate age-out policies):
 * 26.  otp_verifications              purge expired (after 24h)
 * 27.  processed_messages             purge old (after 7 days)
 * 28.  knowledge_chunks (orphaned)    purge is_deleted=true (after 30 days)
 * 29.  cron_execution_log             purge (after 90 days)
 * 30.  billing_system_health          purge (after 90 days)
 */

import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { deletePreviewFromStorage } from "../../services/storageService.js";
import { logger } from "../logger.js";

const CUTOFF_30D = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const CUTOFF_7D  = () => new Date(Date.now() -  7 * 24 * 60 * 60 * 1000);
const CUTOFF_90D = () => new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

/**
 * Execute a raw DELETE and return the number of rows affected.
 */
const execDelete = async (sql, replacements = []) => {
  try {
    const [, meta] = await db.sequelize.query(sql, { replacements });
    return meta?.affectedRows ?? 0;
  } catch (err) {
    logger.error(`[HardDeleteCron] SQL error: ${err.message}\n  SQL: ${sql}`);
    return 0;
  }
};

const log = (table, count) => {
  if (count > 0) logger.info(`[HardDeleteCron] ${table}: purged ${count} row(s)`);
};

// ── 1. campaign_events ────────────────────────────────────────────────────────
const purgeCampaignEvents = async (cutoff) => {
  const n = await execDelete(
    `DELETE ce
     FROM ${tableNames.CAMPAIGN_EVENTS} ce
     JOIN ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r ON r.id = ce.recipient_id
     JOIN ${tableNames.WHATSAPP_CAMPAIGN} c ON c.campaign_id = r.campaign_id
     WHERE c.is_deleted = true AND c.deleted_at < ?`,
    [cutoff],
  );
  log("campaign_events", n);
};

// ── 2. whatsapp_campaign_recipients ──────────────────────────────────────────
const purgeCampaignRecipients = async (cutoff) => {
  const n = await execDelete(
    `DELETE r
     FROM ${tableNames.WHATSAPP_CAMPAIGN_RECIPIENT} r
     JOIN ${tableNames.WHATSAPP_CAMPAIGN} c ON c.campaign_id = r.campaign_id
     WHERE c.is_deleted = true AND c.deleted_at < ?`,
    [cutoff],
  );
  log("whatsapp_campaign_recipients", n);
};

// ── 3. whatsapp_campaigns ────────────────────────────────────────────────────
const purgeCampaigns = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.WHATSAPP_CAMPAIGN}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("whatsapp_campaigns", n);
};

// ── 4. whatsapp_template_sync_logs ────────────────────────────────────────────
const purgeTemplateSyncLogs = async (cutoff) => {
  const n = await execDelete(
    `DELETE sl
     FROM ${tableNames.WHATSAPP_TEMPLATE_SYNC_LOGS} sl
     JOIN ${tableNames.WHATSAPP_TEMPLATE} t ON t.template_id = sl.template_id
     WHERE t.is_deleted = true AND t.deleted_at < ?`,
    [cutoff],
  );
  log("whatsapp_template_sync_logs", n);
};

// ── 5. whatsapp_template_variables ───────────────────────────────────────────
const purgeTemplateVariables = async (cutoff) => {
  const n = await execDelete(
    `DELETE v
     FROM ${tableNames.WHATSAPP_TEMPLATE_VARIABLES} v
     JOIN ${tableNames.WHATSAPP_TEMPLATE} t ON t.template_id = v.template_id
     WHERE t.is_deleted = true AND t.deleted_at < ?`,
    [cutoff],
  );
  log("whatsapp_template_variables", n);
};

// ── 6. whatsapp_templates_components ─────────────────────────────────────────
const purgeTemplateComponents = async (cutoff) => {
  const n = await execDelete(
    `DELETE c
     FROM ${tableNames.WHATSAPP_TEMPLATE_COMPONENTS} c
     JOIN ${tableNames.WHATSAPP_TEMPLATE} t ON t.template_id = c.template_id
     WHERE t.is_deleted = true AND t.deleted_at < ?`,
    [cutoff],
  );
  log("whatsapp_templates_components", n);
};

// ── 7. whatsapp_templates ─────────────────────────────────────────────────────
const purgeTemplates = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.WHATSAPP_TEMPLATE}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("whatsapp_templates", n);
};

// ── 8. knowledge_chunks (orphaned) ───────────────────────────────────────────
const purgeOrphanedChunks = async (cutoff) => {
  // Chunks whose parent source is soft-deleted and past window
  const n = await execDelete(
    `DELETE kc
     FROM ${tableNames.KNOWLEDGECHUNKS} kc
     JOIN ${tableNames.KNOWLEDGESOURCE} ks ON ks.id = kc.source_id
     WHERE ks.is_deleted = true AND ks.deleted_at < ?`,
    [cutoff],
  );
  log("knowledge_chunks (orphaned)", n);
};

// ── 9. faq_knowledge_source ───────────────────────────────────────────────────
const purgeFaqKnowledgeSource = async (cutoff) => {
  const n = await execDelete(
    `DELETE fk
     FROM ${tableNames.FAQ_KNOWLEDGE_SOURCE} fk
     JOIN ${tableNames.FAQ_REVIEWS} fr ON fr.id = fk.faq_review_id
     WHERE fr.status = 'deleted' AND fr.deleted_at < ?`,
    [cutoff],
  );
  log("faq_knowledge_source", n);
};

// ── 10. faq_reviews ───────────────────────────────────────────────────────────
const purgeFaqReviews = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.FAQ_REVIEWS}
     WHERE status = 'deleted' AND deleted_at < ?`,
    [cutoff],
  );
  log("faq_reviews", n);
};

// ── 11. knowledge_sources ─────────────────────────────────────────────────────
const purgeKnowledgeSources = async (cutoff) => {
  // Chunks were already cleaned in step 8
  const n = await execDelete(
    `DELETE FROM ${tableNames.KNOWLEDGESOURCE}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("knowledge_sources", n);
};

// ── 12. media_assets (with R2 file purge) ────────────────────────────────────
const purgeMediaAssets = async (cutoff) => {
  // Fetch URLs first (so we can delete from R2 after DB delete)
  const [expiredAssets] = await db.sequelize.query(
    `SELECT media_asset_id, preview_url
     FROM ${tableNames.MEDIA_ASSETS}
     WHERE is_deleted = true AND deleted_at < ?`,
    { replacements: [cutoff] },
  );

  if (!expiredAssets.length) return;

  // DB delete (no FK children)
  const n = await execDelete(
    `DELETE FROM ${tableNames.MEDIA_ASSETS}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("media_assets (DB rows)", n);

  // R2 file purge — run concurrently, non-blocking on error
  const purgeJobs = expiredAssets
    .filter((a) => a.preview_url)
    .map((a) => deletePreviewFromStorage(a.preview_url).catch((err) =>
      logger.warn(`[HardDeleteCron] R2 purge failed for ${a.media_asset_id}: ${err.message}`),
    ));
  await Promise.all(purgeJobs);
  log("media_assets (R2 files)", purgeJobs.length);
};

// ── 13. contact_group_members ─────────────────────────────────────────────────
// Already hard-deleted on parent soft-delete, but clean orphans defensively
const purgeContactGroupMembers = async (cutoff) => {
  const n = await execDelete(
    `DELETE cgm
     FROM ${tableNames.CONTACT_GROUP_MEMBERS} cgm
     JOIN ${tableNames.CONTACTS} c ON c.contact_id = cgm.contact_id
     WHERE c.is_deleted = true AND c.deleted_at < ?`,
    [cutoff],
  );
  log("contact_group_members (orphaned)", n);
};

// ── 14. booking_sessions ──────────────────────────────────────────────────────
const purgeBookingSessions = async (cutoff) => {
  const n = await execDelete(
    `DELETE bs
     FROM ${tableNames.BOOKING_SESSIONS} bs
     JOIN ${tableNames.CONTACTS} c ON c.contact_id = bs.contact_id
     WHERE c.is_deleted = true AND c.deleted_at < ?`,
    [cutoff],
  );
  log("booking_sessions (orphaned)", n);
};

// ── 15. messages ──────────────────────────────────────────────────────────────
const purgeMessages = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.MESSAGES}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("messages", n);
};

// ── 16. live_chats ────────────────────────────────────────────────────────────
const purgeLiveChats = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.LIVECHAT}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("live_chats", n);
};

// ── 17. leads ─────────────────────────────────────────────────────────────────
const purgeLeads = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.LEADS}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("leads", n);
};

// ── 18. appointments ──────────────────────────────────────────────────────────
const purgeAppointments = async (cutoff) => {
  // booking_sessions cleaned in step 14
  const n = await execDelete(
    `DELETE FROM ${tableNames.APPOINTMENTS}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("appointments", n);
};

// ── 19. contacts ──────────────────────────────────────────────────────────────
const purgeContacts = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.CONTACTS}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("contacts", n);
};

// ── 20. contact_groups ────────────────────────────────────────────────────────
const purgeContactGroups = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.CONTACT_GROUPS}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("contact_groups", n);
};

// ── 21. doctor_specializations ────────────────────────────────────────────────
const purgeDoctorSpecializations = async (cutoff) => {
  const n = await execDelete(
    `DELETE ds
     FROM ${tableNames.DOCTOR_SPECIALIZATIONS} ds
     JOIN ${tableNames.DOCTORS} d ON d.doctor_id = ds.doctor_id
     WHERE d.is_deleted = true AND d.deleted_at < ?`,
    [cutoff],
  );
  log("doctor_specializations (orphaned)", n);
};

// ── 22. doctor_availability ───────────────────────────────────────────────────
const purgeDoctorAvailability = async (cutoff) => {
  const n = await execDelete(
    `DELETE da
     FROM ${tableNames.DOCTOR_AVAILABILITY} da
     JOIN ${tableNames.DOCTORS} d ON d.doctor_id = da.doctor_id
     WHERE d.is_deleted = true AND d.deleted_at < ?`,
    [cutoff],
  );
  log("doctor_availability (orphaned)", n);
};

// ── 23. doctors ───────────────────────────────────────────────────────────────
const purgeDoctors = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.DOCTORS}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("doctors", n);
};

// ── 24. specializations ───────────────────────────────────────────────────────
const purgeSpecializations = async (cutoff) => {
  // doctor_specializations cleaned in step 21
  const n = await execDelete(
    `DELETE FROM ${tableNames.SPECIALIZATIONS}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("specializations", n);
};

// ── 25. ai_prompts ────────────────────────────────────────────────────────────
const purgeAiPrompts = async (cutoff) => {
  const n = await execDelete(
    `DELETE FROM ${tableNames.AIPROMPT}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("ai_prompts", n);
};

// ── SYSTEM CLEANUP (separate age-out policies) ────────────────────────────────

const purgeExpiredOtps = async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h
  const n = await execDelete(
    `DELETE FROM ${tableNames.OTP_VERIFICATIONS} WHERE expires_at < ?`,
    [cutoff],
  );
  log("otp_verifications (expired)", n);
};

const purgeOldProcessedMessages = async () => {
  const cutoff = CUTOFF_7D();
  const n = await execDelete(
    `DELETE FROM ${tableNames.PROCESSEDMESSAGE} WHERE created_at < ?`,
    [cutoff],
  );
  log("processed_messages", n);
};

const purgeSoftDeletedChunks = async () => {
  const cutoff = CUTOFF_30D();
  const n = await execDelete(
    `DELETE FROM ${tableNames.KNOWLEDGECHUNKS}
     WHERE is_deleted = true AND deleted_at < ?`,
    [cutoff],
  );
  log("knowledge_chunks (soft-deleted)", n);
};

const purgeCronLogs = async () => {
  const cutoff = CUTOFF_90D();
  const n = await execDelete(
    `DELETE FROM ${tableNames.CRON_EXECUTION_LOG} WHERE created_at < ?`,
    [cutoff],
  );
  log("cron_execution_log", n);
};

const purgeBillingHealthLogs = async () => {
  const cutoff = CUTOFF_90D();
  const n = await execDelete(
    `DELETE FROM ${tableNames.BILLING_SYSTEM_HEALTH}
     WHERE resolved = true AND created_at < ?`,
    [cutoff],
  );
  log("billing_system_health (resolved)", n);
};

// ── MASTER EXPORT ─────────────────────────────────────────────────────────────

export const runHardDeleteCron = async () => {
  const started = Date.now();
  logger.info("[HardDeleteCron] Starting nightly hard-delete pass…");

  const cutoff = CUTOFF_30D();

  try {
    // ── Campaigns (children first) ──────────────────────────────────────────
    await purgeCampaignEvents(cutoff);
    await purgeCampaignRecipients(cutoff);
    await purgeCampaigns(cutoff);

    // ── Templates (children first) ──────────────────────────────────────────
    await purgeTemplateSyncLogs(cutoff);
    await purgeTemplateVariables(cutoff);
    await purgeTemplateComponents(cutoff);
    await purgeTemplates(cutoff);

    // ── Knowledge + FAQ (children first) ────────────────────────────────────
    await purgeOrphanedChunks(cutoff);
    await purgeFaqKnowledgeSource(cutoff);
    await purgeFaqReviews(cutoff);
    await purgeKnowledgeSources(cutoff);

    // ── Media assets (with R2 purge) ─────────────────────────────────────────
    await purgeMediaAssets(cutoff);

    // ── Contacts + children (children first) ────────────────────────────────
    await purgeContactGroupMembers(cutoff);
    await purgeBookingSessions(cutoff);
    await purgeMessages(cutoff);
    await purgeLiveChats(cutoff);
    await purgeLeads(cutoff);
    await purgeAppointments(cutoff);
    await purgeContacts(cutoff);
    await purgeContactGroups(cutoff);

    // ── Doctors + children (children first) ─────────────────────────────────
    await purgeDoctorSpecializations(cutoff);
    await purgeDoctorAvailability(cutoff);
    await purgeDoctors(cutoff);

    // ── Standalone Tier 1 ────────────────────────────────────────────────────
    await purgeSpecializations(cutoff);
    await purgeAiPrompts(cutoff);

    // ── System cleanup (age-out policies) ────────────────────────────────────
    await purgeExpiredOtps();
    await purgeOldProcessedMessages();
    await purgeSoftDeletedChunks();
    await purgeCronLogs();
    await purgeBillingHealthLogs();

    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    logger.info(`[HardDeleteCron] Completed in ${elapsed}s`);
  } catch (err) {
    logger.error("[HardDeleteCron] Fatal error:", err.message, err.stack);
    // Do not throw — cron runner must not crash
  }
};
