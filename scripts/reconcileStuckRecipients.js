/**
 * One-time reconciliation for campaign recipients left pending after exhausted
 * network/system send failures were copied to campaignDLQ-{tenantId}.
 *
 * Dry run (default):
 *   node scripts/reconcileStuckRecipients.js
 *
 * Apply database updates and remove successfully reconciled DLQ jobs:
 *   node scripts/reconcileStuckRecipients.js --apply
 */

import "dotenv/config";
import IORedis from "ioredis";
import { Queue } from "bullmq";
import db from "../src/database/index.js";

const APPLY = process.argv.includes("--apply");
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const DLQ_KEY_PATTERN = "bull:campaignDLQ-*:*";
const DLQ_QUEUE_PREFIX = "campaignDLQ-";
const TARGET_STATUS = "permanently_failed";

const summary = {
  total_jobs_scanned: 0,
  updated: 0,
  would_update: 0,
  orphaned_deleted: 0,
  orphaned_soft_deleted: 0,
  already_resolved: 0,
};

const redis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const openQueues = [];
const EXPECTED_TERMINAL_RECIPIENT_STATUSES = [
  "sent",
  "delivered",
  "read",
  "replied",
  "permanently_failed",
];

const discoverDlqQueueNames = async () => {
  const queueNames = new Set();
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      DLQ_KEY_PATTERN,
      "COUNT",
      250,
    );
    cursor = nextCursor;

    for (const key of keys) {
      const match = key.match(/^bull:(campaignDLQ-[^:]+):/);
      if (match?.[1]) queueNames.add(match[1]);
    }
  } while (cursor !== "0");

  return Array.from(queueNames).sort();
};

const getTenantIdFromQueueName = (queueName) =>
  queueName.startsWith(DLQ_QUEUE_PREFIX)
    ? queueName.slice(DLQ_QUEUE_PREFIX.length)
    : "";

const buildLastError = ({ reason, attemptsMade, dlqJobId }) =>
  JSON.stringify({
    code: null,
    subcode: null,
    message: reason,
    error_data: null,
    is_network_error: true,
    is_permanent: false,
    timestamp: new Date().toISOString(),
    source: "campaign_dlq_reconciliation",
    attempts_made: attemptsMade,
    dlq_job_id: dlqJobId,
  });

const captureDiagnosticStack = (message) => {
  const error = new Error(message);
  return error.stack || message;
};

const logFailure = ({
  phase,
  queueName,
  queueTenantId,
  tenantId,
  campaignId,
  recipientId,
  job,
  payload,
  message,
  stack,
}) => {
  console.error(
    `[ERROR][${phase}] queue=${queueName} queue_tenant=${queueTenantId || "missing"} job_id=${job?.id || "unknown"} tenant_id=${tenantId || "missing"} campaign_id=${campaignId || "missing"} recipient_id=${recipientId || "missing"} ` +
      `types(recipient=${typeof recipientId}, campaign=${typeof campaignId}, tenant=${typeof tenantId}) payload=${JSON.stringify(payload)}`,
  );
  console.error(`[ERROR][${phase}] message=${message}`);
  console.error(`[ERROR][${phase}] stack=${stack || captureDiagnosticStack(message)}`);
};

const maybeRemoveJob = async (job, message) => {
  if (!APPLY) {
    console.log(`[DRY-RUN] ${message}`);
    return;
  }

  await job.remove();
  console.log(`[REMOVED] ${message}`);
};

const finalizeCampaignIfComplete = async (campaignId) => {
  if (!campaignId) return;

  const remainingPending = await db.WhatsappCampaignRecipients.count({
    where: { campaign_id: campaignId, status: "pending", is_deleted: false },
  });
  if (remainingPending > 0) return;

  const unexpected = await db.WhatsappCampaignRecipients.findAll({
    where: {
      campaign_id: campaignId,
      is_deleted: false,
      status: {
        [db.Sequelize.Op.notIn]: EXPECTED_TERMINAL_RECIPIENT_STATUSES,
      },
    },
    attributes: ["status"],
    group: ["status"],
    raw: true,
  });
  if (unexpected.length > 0) return;

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await db.WhatsappCampaigns.update(
    { status: "completed" },
    {
      where: {
        campaign_id: campaignId,
        status: {
          [db.Sequelize.Op.in]: ["active", "failed", "scheduled", "draft"],
        },
        [db.Sequelize.Op.or]: [
          db.sequelize.where(
            db.sequelize.col("last_dispatch_enqueued_at"),
            db.Sequelize.Op.is,
            null,
          ),
          db.sequelize.where(
            db.sequelize.col("last_dispatch_enqueued_at"),
            db.Sequelize.Op.lt,
            fiveMinutesAgo,
          ),
        ],
      },
    },
  );
};

const classifyExistingState = async ({
  queueName,
  queueTenantId,
  tenantId,
  campaignId,
  recipientId,
  job,
  label,
}) => {
  const current = await db.WhatsappCampaignRecipients.findOne({
    where: {
      id: recipientId,
      campaign_id: campaignId,
    },
    include: [
      {
        model: db.WhatsappCampaigns,
        as: "campaign",
        required: true,
        where: { tenant_id: tenantId },
        attributes: ["campaign_id", "tenant_id", "is_deleted"],
      },
    ],
  });

  if (!current) {
    summary.orphaned_deleted += 1;
    await maybeRemoveJob(job, `Missing recipient/campaign pair for ${label}`);
    return;
  }

  if (current.is_deleted && current.campaign?.is_deleted) {
    summary.orphaned_soft_deleted += 1;
    await maybeRemoveJob(
      job,
      `Soft-deleted recipient/campaign pair for ${label}`,
    );
    return;
  }

  if (current.status !== "pending") {
    summary.already_resolved += 1;
    await maybeRemoveJob(
      job,
      `Recipient already resolved with status ${current.status}: ${label}`,
    );
    return;
  }

  logFailure({
    phase: "post-update-race",
    queueName,
    queueTenantId,
    tenantId,
    campaignId,
    recipientId,
    job,
    payload: job?.data?.payload || {},
    message: `Recipient remained pending after zero-row update: ${label}`,
  });
};

const reconcileJob = async (queueName, queueTenantId, job) => {
  summary.total_jobs_scanned += 1;

  const payload = job?.data?.payload || {};
  const recipientId = payload.recipient_id;
  const campaignId = payload.campaign_id;
  const tenantId = String(
    job?.data?.tenant_id || payload.tenant_id || queueTenantId || "",
  ).trim();
  const reason = String(job?.data?.reason || "Unknown exhausted send failure");
  const attemptsMade = Number(job?.data?.attempts_made || 0);
  const label = `queue=${queueName} dlq_job=${job?.id || "unknown"} tenant=${tenantId || "missing"} campaign=${campaignId || "missing"} recipient=${recipientId || "missing"}`;

  if (!recipientId || !campaignId || !tenantId) {
    summary.orphaned_deleted += 1;
    logFailure({
      phase: "payload-validation",
      queueName,
      queueTenantId,
      tenantId,
      campaignId,
      recipientId,
      job,
      payload,
      message: `Invalid DLQ payload: ${label}`,
    });
    return;
  }

  if (queueTenantId && tenantId !== queueTenantId) {
    summary.orphaned_deleted += 1;
    logFailure({
      phase: "tenant-validation",
      queueName,
      queueTenantId,
      tenantId,
      campaignId,
      recipientId,
      job,
      payload,
      message: `Tenant mismatch: ${label} queue_tenant=${queueTenantId}`,
    });
    return;
  }

  try {
    const recipient = await db.WhatsappCampaignRecipients.findOne({
      where: {
        id: recipientId,
        campaign_id: campaignId,
        is_deleted: false,
      },
      include: [
        {
          model: db.WhatsappCampaigns,
          as: "campaign",
          required: true,
          where: { tenant_id: tenantId, is_deleted: false },
          attributes: ["campaign_id", "tenant_id"],
        },
      ],
    });

    if (!recipient) {
      await classifyExistingState({
        queueName,
        queueTenantId,
        tenantId,
        campaignId,
        recipientId,
        job,
        label,
      });
      return;
    }

    if (recipient.status !== "pending") {
      summary.already_resolved += 1;
      await maybeRemoveJob(
        job,
        `Recipient already resolved with status ${recipient.status}: ${label}`,
      );
      return;
    }

    const updateFields = {
      status: TARGET_STATUS,
      error_message: reason,
      last_error: buildLastError({
        reason,
        attemptsMade,
        dlqJobId: job.id,
      }),
      retry_count: attemptsMade,
      next_retry_at: null,
    };

    if (!APPLY) {
      summary.would_update += 1;
      console.log(
        `[DRY-RUN] Would update recipient to ${TARGET_STATUS}: ${label} reason=${JSON.stringify(reason)} attempts=${attemptsMade}`,
      );
      return;
    }

    const [affectedRows] = await db.WhatsappCampaignRecipients.update(
      updateFields,
      {
        where: {
          id: recipientId,
          campaign_id: campaignId,
          status: "pending",
          is_deleted: false,
        },
      },
    );

    if (affectedRows !== 1) {
      await classifyExistingState({
        queueName,
        queueTenantId,
        tenantId,
        campaignId,
        recipientId,
        job,
        label,
      });
      return;
    }

    await finalizeCampaignIfComplete(campaignId);
    await job.remove();
    summary.updated += 1;
    console.log(`[UPDATED] Recipient reconciled and DLQ job removed: ${label}`);
  } catch (error) {
    logFailure({
      phase: APPLY ? "conditional-update" : "db-lookup",
      queueName,
      queueTenantId,
      tenantId,
      campaignId,
      recipientId,
      job,
      payload,
      message: `Reconciliation failed: ${label}: ${error.message}`,
      stack: error.stack,
    });
  }
};

const main = async () => {
  console.log(
    `[START] Campaign DLQ reconciliation mode=${APPLY ? "APPLY" : "DRY-RUN"}`,
  );

  const pong = await redis.ping();
  if (pong !== "PONG") {
    throw new Error(`Unexpected Redis PING response: ${pong}`);
  }

  await db.sequelize.authenticate();

  const queueNames = await discoverDlqQueueNames();
  console.log(`[INFO] Discovered ${queueNames.length} campaign DLQ queue(s).`);

  for (const queueName of queueNames) {
    const queueTenantId = getTenantIdFromQueueName(queueName);
    const queue = new Queue(queueName, { connection: redis });
    openQueues.push(queue);

    const waitingJobs = await queue.getWaiting(0, -1);
    console.log(
      `[INFO] ${queueName}: ${waitingJobs.length} waiting job(s) found.`,
    );

    for (const job of waitingJobs) {
      await reconcileJob(queueName, queueTenantId, job);
    }
  }
};

try {
  await main();
} catch (error) {
  console.error("[FATAL] Reconciliation aborted:", error.stack || error.message);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(openQueues.map((queue) => queue.close()));
  await db.sequelize.close().catch(() => {});

  try {
    if (redis.status === "ready") {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  } catch {
    redis.disconnect();
  }

  console.log("[SUMMARY]", summary);
}
