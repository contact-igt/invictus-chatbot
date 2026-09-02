/**
 * FIX 11 — periodic Meta tier / quality reconciliation.
 *
 * Sync is otherwise only triggered by dashboard/account page loads and by the
 * quality/capability webhooks. This backstop refreshes every active/verified
 * WhatsApp account on a schedule so a missed webhook cannot leave the cached
 * tier stale indefinitely.
 *
 * Reuses syncWabaMetaInfoService() — no duplicated Meta API logic. That service
 * already:
 *   - honours the 5-minute freshness/dedup cache
 *   - preserves the last-known tier when Meta returns an incomplete response
 *   - updates quality, tier, meta_info_synced_at
 */
import db from "../database/index.js";
import { logger } from "../utils/logger.js";
import { syncWabaMetaInfoService } from "../models/WhatsappAccountModel/whatsappAccount.service.js";

const BATCH_PAUSE_MS = 250; // gentle spacing so a large fleet doesn't burst Meta

export const runMetaTierReconciliationCron = async () => {
  let accounts = [];
  try {
    accounts = await db.Whatsappaccount.findAll({
      where: {
        is_deleted: false,
        status: ["active", "verified"],
      },
      attributes: ["tenant_id"],
      raw: true,
    });
  } catch (err) {
    logger.error(`[META-TIER-RECON] Could not list accounts: ${err.message}`);
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const acc of accounts) {
    try {
      const result = await syncWabaMetaInfoService(acc.tenant_id);
      if (result) ok += 1;
      else failed += 1;
    } catch (err) {
      failed += 1;
      logger.warn(
        `[META-TIER-RECON] sync failed for tenant ${acc.tenant_id}: ${err.message}`,
      );
    }
    await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
  }

  logger.info(
    `[META-TIER-RECON] Completed: ${ok} synced, ${failed} skipped/failed of ${accounts.length} accounts`,
  );
};
