import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";
import {
  initCampaignQueues,
  getCampaignDispatchQueue,
  getRedisConnection,
  getTenantQueueName,
} from "../queues/campaignQueue.js";
import { Queue, QueueEvents } from "bullmq";
import { logger } from "../utils/logger.js";

const TEST_SIZES = [10, 50, 119, 250, 500];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureTenant() {
  const existing = await db.Tenants.findOne({ where: { is_deleted: false } });
  if (existing) return existing.tenant_id;

  const tenantId = `perf_tenant_${Date.now()}`;
  await db.Tenants.create({
    tenant_id: tenantId,
    company_name: `Perf Tenant ${Date.now()}`,
    owner_name: "Perf Owner",
    owner_email: `perf+${Date.now()}@example.com`,
    type: "organization",
    status: "active",
  });
  return tenantId;
}

async function createTemplate(tenantId) {
  const templateId = `perf_template_${Date.now()}`;
  await db.WhatsappTemplates.create({
    template_id: templateId,
    tenant_id: tenantId,
    template_name: `Perf Template ${Date.now()}`,
    category: "marketing",
    language: "en",
    template_type: "text",
    status: "approved",
    created_by: "perf-test",
  });
  return templateId;
}

async function createCampaign(tenantId, templateId, recipientCount) {
  const campaignId = `perf_campaign_${Date.now()}`;
  await db.WhatsappCampaigns.create({
    campaign_id: campaignId,
    tenant_id: tenantId,
    campaign_name: `Perf Campaign ${Date.now()}`,
    campaign_type: "broadcast",
    template_id: templateId,
    status: "active",
    total_audience: recipientCount,
    created_by: "perf-test",
  });
  return campaignId;
}

async function activateCampaignForTest(campaignId) {
  await db.WhatsappCampaigns.update(
    { status: "active" },
    { where: { campaign_id: campaignId } },
  );
}

async function createRecipients(campaignId, count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    campaign_id: campaignId,
    mobile_number: `91${9000000000 + i}`,
    dynamic_variables: [],
    status: "pending",
  }));
  // Bulk create in one query
  await db.WhatsappCampaignRecipients.bulkCreate(rows);
}

async function waitForCompletion(campaignId, expectedCount) {
  const timeoutMs = Math.max(600000, expectedCount * 2000);
  return new Promise(async (resolve) => {
    const counted = new Set();
    let queueEvents = null;
    let queue = null;
    let timeoutId = null;

    const cleanup = async () => {
      try {
        if (queueEvents) await queueEvents.close();
      } catch (e) {
        // ignore
      }
      try {
        if (queue) await queue.close();
      } catch (e) {
        // ignore
      }
      if (timeoutId) clearTimeout(timeoutId);
    };

    try {
      const campaign = await db.WhatsappCampaigns.findOne({
        where: { campaign_id: campaignId },
        attributes: ["tenant_id"],
        raw: true,
      });
      if (!campaign || !campaign.tenant_id) {
        logger.warn(
          `[PERF] waitForCompletion: campaign ${campaignId} tenant_id not found`,
        );
        await cleanup();
        return resolve(false);
      }

      const tenantId = String(campaign.tenant_id);
      const queueName = getTenantQueueName(tenantId);
      const redisConnection = getRedisConnection();

      queueEvents = new QueueEvents(queueName, { connection: redisConnection });
      queue = new Queue(queueName, { connection: redisConnection });

      const handleTerminalEvent = async ({ jobId }) => {
        try {
          // Try to read job payload to verify campaign_id
          const job = await queue.getJob(jobId);
          let recipientId = null;
          let jobMatches = false;
          if (job && job.data) {
            if (job.data.campaign_id === campaignId) {
              recipientId = String(
                job.data.recipient_id ||
                  job.data.recipientId ||
                  job.data.id ||
                  jobId,
              );
              jobMatches = true;
            }
          }

          // Fallback: parse recipient id from jobId like 'send:123'
          if (
            !jobMatches &&
            typeof jobId === "string" &&
            jobId.startsWith("send:")
          ) {
            const parts = jobId.split(":");
            if (parts[1]) {
              const candidateId = parts[1];
              const rec = await db.WhatsappCampaignRecipients.findOne({
                where: { id: candidateId, campaign_id: campaignId },
                attributes: ["id", "status"],
                raw: true,
              });
              if (rec && ["sent", "permanently_failed"].includes(rec.status)) {
                recipientId = String(rec.id);
                jobMatches = true;
              }
            }
          }

          if (jobMatches && recipientId && !counted.has(recipientId)) {
            counted.add(recipientId);
            process.stdout.write(
              `\rProgress: ${counted.size}/${expectedCount}`,
            );
            if (counted.size >= expectedCount) {
              void cleanup().then(() => resolve(true));
            }
          }
        } catch (e) {
          logger.debug(`[PERF] handleTerminalEvent error: ${e.message}`);
        }
      };

      queueEvents.on("completed", handleTerminalEvent);
      queueEvents.on("failed", handleTerminalEvent);

      // Safety timeout
      timeoutId = setTimeout(() => {
        void cleanup().then(() => resolve(false));
      }, timeoutMs);
    } catch (err) {
      logger.warn(`[PERF] waitForCompletion setup failed: ${err.message}`);
      await cleanup();
      return resolve(false);
    }
  });
}

async function cleanup(campaignId, templateId) {
  try {
    await db.WhatsappCampaignRecipients.destroy({
      where: { campaign_id: campaignId },
    });
  } catch (e) {
    logger.warn(`[PERF] cleanup recipients failed: ${e.message}`);
  }
  try {
    await db.WhatsappCampaigns.destroy({ where: { campaign_id: campaignId } });
  } catch (e) {
    logger.warn(`[PERF] cleanup campaign failed: ${e.message}`);
  }
  try {
    await db.WhatsappTemplates.destroy({ where: { template_id: templateId } });
  } catch (e) {
    logger.warn(`[PERF] cleanup template failed: ${e.message}`);
  }
}

async function run() {
  console.log("Starting campaign performance tests...");
  console.log(
    "DB env:",
    process.env.DATABASE_HOST,
    process.env.DATABASE_USER,
    process.env.DATABASE_DB,
  );
  await db.sequelize.authenticate();
  await initCampaignQueues();
  const dispatchQueue = getCampaignDispatchQueue();
  if (!dispatchQueue) {
    console.error(
      "Dispatch queue not available (Redis unreachable). Start Redis or ensure REDIS_URL.",
    );
    process.exit(1);
  }

  const tenantId = await ensureTenant();

  const results = [];
  for (const size of TEST_SIZES) {
    console.log(`\n=== Testing ${size} recipients ===`);
    const templateId = await createTemplate(tenantId);
    const campaignId = await createCampaign(tenantId, templateId, size);
    await activateCampaignForTest(campaignId);
    await createRecipients(campaignId, size);

    // Debug: verify queue names and workers
    const tenantQueueName = getTenantQueueName(tenantId);
    const redisConnection = getRedisConnection();
    let debugWorkers = [];
    try {
      if (redisConnection) {
        const debugQueue = new Queue(tenantQueueName, {
          connection: redisConnection,
        });
        try {
          debugWorkers = await debugQueue.getWorkers();
        } catch (e) {
          console.log("Workers found: error", e.message);
        }
        await debugQueue.close();
      } else {
        console.log("No Redis connection available for debug");
      }
    } catch (e) {
      console.log("Queue debug error:", e.message);
    }

    console.log("Queue name:", tenantQueueName);
    console.log("Dispatch queue:", dispatchQueue?.name || "unknown");
    let redisStatus = "disconnected";
    if (redisConnection) {
      try {
        await redisConnection.ping();
        redisStatus = `connected (${redisConnection.status || "ready"})`;
      } catch (e) {
        redisStatus = `error (${e.message})`;
      }
    }
    console.log("Redis:", redisStatus);
    console.log("Workers found:", debugWorkers);

    // Ensure at least one send worker is connected to the tenant queue
    if (!Array.isArray(debugWorkers) || debugWorkers.length === 0) {
      console.error("ERROR: No workers connected! Start the worker first:");
      console.error("  node src/workers/campaignSendWorker.js");
      process.exit(1);
    }

    const start = Date.now();
    await dispatchQueue.add(
      "campaign-dispatch",
      { campaign_id: campaignId, tenant_id: tenantId, after_id: 0 },
      { jobId: `dispatch:${campaignId}:0` },
    );

    const waited = await waitForCompletion(campaignId, size);
    const durationMs = Date.now() - start;

    // Allow small buffer flush for DB writes
    await sleep(3000);

    const [[countRow]] = await db.sequelize.query(
      "SELECT count(*) as cnt FROM whatsapp_campaign_recipients WHERE campaign_id = ? AND status IN ('sent','permanently_failed')",
      { replacements: [campaignId] },
    );
    const actualSent = Number(countRow.cnt || Object.values(countRow)[0] || 0);
    const success = actualSent >= size;
    const throughput = ((actualSent || 0) / (durationMs / 1000) || 0).toFixed(
      2,
    );
    console.log(
      `Campaign ${campaignId}: ${actualSent}/${size} sent in ${durationMs}ms`,
    );
    results.push({ recipients: size, durationMs, throughput, success });

    await cleanup(campaignId, templateId);
    // small cooldown between tests
    await sleep(1500);
  }

  console.log("\nSummary:");
  console.table(results);
}

run()
  .then(() => {
    console.log("Performance tests finished");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Performance test error:", err);
    process.exit(1);
  });
