/**
 * Verify deterministic failed send-job cleanup for campaign recipient retry.
 *
 * Dry run:
 *   node scripts/checkFailedSendJobRetryDedup.js --tenant TT001 --campaign CAMP00016 --recipient 16
 *
 * Remove the existing job and confirm it is gone:
 *   node scripts/checkFailedSendJobRetryDedup.js --tenant TT001 --campaign CAMP00016 --recipient 16 --apply
 */

import "dotenv/config";
import {
  closeCampaignQueues,
  getTenantQueue,
  initCampaignQueues,
  isCampaignQueueAvailable,
} from "../src/queues/campaignQueue.js";
import {
  buildSendJobId,
  inspectSendJob,
  removeSendJobIfPresent,
} from "../src/workers/sendJobHelpers.js";

const readArg = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
};

const APPLY = process.argv.includes("--apply");
const tenantId = String(readArg("--tenant") || process.env.TEST_TENANT_ID || "").trim();
const campaignId = String(readArg("--campaign") || "").trim();
const recipientId = Number(readArg("--recipient") || 0);

if (!tenantId || !campaignId || !recipientId) {
  console.error(
    "Usage: node scripts/checkFailedSendJobRetryDedup.js --tenant <tenantId> --campaign <campaignId> --recipient <recipientId> [--apply]",
  );
  process.exit(1);
}

try {
  await initCampaignQueues();

  if (!isCampaignQueueAvailable()) {
    throw new Error("Campaign queue unavailable");
  }

  const sendQueue = getTenantQueue(tenantId);
  const jobId = buildSendJobId(campaignId, recipientId);

  const before = await inspectSendJob(sendQueue, campaignId, recipientId);
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "APPLY" : "DRY-RUN",
        tenant_id: tenantId,
        campaign_id: campaignId,
        recipient_id: recipientId,
        expected_job_id: jobId,
        before: {
          found: before.found,
          state: before.state,
        },
      },
      null,
      2,
    ),
  );

  if (!before.found) {
    console.log("[INFO] No existing deterministic send job found.");
    process.exit(0);
  }

  if (!APPLY) {
    console.log("[DRY-RUN] Existing send job found; rerun with --apply to remove it.");
    process.exit(0);
  }

  const removal = await removeSendJobIfPresent(sendQueue, campaignId, recipientId, {
    logContext: "SEND-JOB-CHECK",
  });
  const after = await inspectSendJob(sendQueue, campaignId, recipientId);

  console.log(
    JSON.stringify(
      {
        removal: {
          found: removal.found,
          removed: removal.removed,
          state: removal.state,
          error: removal.error || null,
        },
        after: {
          found: after.found,
          state: after.state,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("[FAILED]", error.stack || error.message);
  process.exitCode = 1;
} finally {
  await closeCampaignQueues().catch(() => {});
}
