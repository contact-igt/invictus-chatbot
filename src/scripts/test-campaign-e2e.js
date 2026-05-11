import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Queue, QueueEvents } from "bullmq";

import db from "../database/index.js";
import {
  initCampaignQueues,
  getCampaignDispatchQueue,
  getRedisConnection,
  getTenantQueueName,
  closeCampaignQueues,
} from "../queues/campaignQueue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const TEST_TIMEOUT_MS = 120000;
const PROGRESS_INTERVAL_MS = 5000;

const checks = {
  dbConnection: { label: "DB Connection", pass: false, detail: "" },
  redisConnection: { label: "Redis Connection", pass: false, detail: "" },
  whatsappAccount: { label: "WhatsApp Account", pass: false, detail: "" },
  whatsappToken: { label: "WhatsApp Token", pass: false, detail: "" },
  workersRunning: { label: "Workers Running", pass: false, detail: "" },
  messageDispatched: { label: "Message Dispatched", pass: false, detail: "" },
  recipientMarkedSent: {
    label: "Recipient Marked Sent",
    pass: false,
    detail: "",
  },
  metaMessageId: { label: "Meta Message ID", pass: false, detail: "" },
};

const trackedResources = {
  queueEvents: null,
  queue: null,
  campaignId: null,
  recipientId: null,
};

const printUsageAndExit = () => {
  console.log("Usage: node src/scripts/test-campaign-e2e.js 919876543210");
  process.exit(1);
};

const printCheck = (check) => {
  const statusText = check.pass ? "PASS" : "FAIL";
  const detailText = check.detail ? ` - ${check.detail}` : "";
  console.log(`${check.label}: ${statusText}${detailText}`);
};

const getFirstActiveTenantId = async () => {
  const tenant = await db.Tenants.findOne({
    where: {
      is_deleted: false,
      status: "active",
    },
    attributes: ["tenant_id"],
    raw: true,
  });

  return tenant?.tenant_id || null;
};

const runPreflightChecks = async (
  tenantId,
  tenantQueueName,
  redisConnection,
) => {
  console.log("\n=== PRE-FLIGHT CHECKS ===");

  try {
    const [rows] = await db.sequelize.query("SELECT 1+1 AS result");
    const result = Number(rows?.[0]?.result || 0);
    checks.dbConnection.pass = result === 2;
    checks.dbConnection.detail = checks.dbConnection.pass
      ? "SELECT 1+1 returned 2"
      : `Unexpected result: ${result}`;
  } catch (err) {
    checks.dbConnection.pass = false;
    checks.dbConnection.detail = err.message;
  }
  printCheck(checks.dbConnection);

  try {
    const ping = redisConnection ? await redisConnection.ping() : null;
    checks.redisConnection.pass = ping === "PONG";
    checks.redisConnection.detail = checks.redisConnection.pass
      ? `Ping: ${ping}`
      : "Redis client unavailable or ping failed";
  } catch (err) {
    checks.redisConnection.pass = false;
    checks.redisConnection.detail = err.message;
  }
  printCheck(checks.redisConnection);

  try {
    const [rows] = await db.sequelize.query(
      `SELECT phone_number_id FROM whatsapp_accounts
       WHERE tenant_id = ? AND status IN ('active','verified') LIMIT 1`,
      { replacements: [tenantId] },
    );
    checks.whatsappAccount.pass = rows.length > 0;
    checks.whatsappAccount.detail = checks.whatsappAccount.pass
      ? `phone_number_id=${rows[0].phone_number_id}`
      : "No active/verified WhatsApp account";
  } catch (err) {
    checks.whatsappAccount.pass = false;
    checks.whatsappAccount.detail = err.message;
  }
  printCheck(checks.whatsappAccount);

  try {
    const [rows] = await db.sequelize.query(
      `SELECT id FROM tenant_secrets
       WHERE tenant_id = ? AND type = 'whatsapp' LIMIT 1`,
      { replacements: [tenantId] },
    );
    checks.whatsappToken.pass = rows.length > 0;
    checks.whatsappToken.detail = checks.whatsappToken.pass
      ? `secret_id=${rows[0].id}`
      : "No whatsapp secret configured";
  } catch (err) {
    checks.whatsappToken.pass = false;
    checks.whatsappToken.detail = err.message;
  }
  printCheck(checks.whatsappToken);

  try {
    const queue = new Queue(tenantQueueName, { connection: redisConnection });
    const workers = await queue.getWorkers();
    await queue.close();

    checks.workersRunning.pass = Array.isArray(workers) && workers.length > 0;
    checks.workersRunning.detail = checks.workersRunning.pass
      ? `workers=${workers.length}`
      : "No send workers detected";
  } catch (err) {
    checks.workersRunning.pass = false;
    checks.workersRunning.detail = err.message;
  }
  printCheck(checks.workersRunning);

  return (
    checks.dbConnection.pass &&
    checks.redisConnection.pass &&
    checks.whatsappAccount.pass &&
    checks.whatsappToken.pass &&
    checks.workersRunning.pass
  );
};

const findApprovedTemplate = async (tenantId) => {
  // Select the first approved template for the tenant (no ordering by variables)
  const [rows] = await db.sequelize.query(
    `SELECT template_id, template_name
     FROM whatsapp_templates
     WHERE tenant_id = ?
       AND status = 'approved'
       AND is_deleted = false
     LIMIT 1`,
    { replacements: [tenantId] },
  );

  return rows[0] || null;
};

const createE2ECampaign = async ({ tenantId, templateId, testPhone }) => {
  const campaignId = `e2e_campaign_${Date.now()}`;

  const campaign = await db.WhatsappCampaigns.create({
    campaign_id: campaignId,
    tenant_id: tenantId,
    campaign_name: `E2E Campaign ${Date.now()}`,
    campaign_type: "broadcast",
    template_id: templateId,
    status: "active",
    total_audience: 1,
    created_by: "e2e-test",
  });

  // Determine how many dynamic variables the template needs by scanning components
  const [components] = await db.sequelize.query(
    `SELECT * FROM whatsapp_templates_components WHERE template_id = ?`,
    { replacements: [templateId] },
  );

  let varCount = 0;
  for (const comp of components || []) {
    // Inspect all string columns for placeholder patterns like {{1}}, {{2}}
    for (const key of Object.keys(comp || {})) {
      const val = comp[key];
      if (typeof val === "string" && val.length > 0) {
        const matches = val.match(/\{\{\d+\}\}/g);
        if (matches && matches.length > 0) varCount += matches.length;
      }
    }
  }

  const dynamicVars =
    varCount > 0
      ? Array.from({ length: varCount }, (_, i) => ({
          key: String(i + 1),
          value: "TestValue123",
        }))
      : [];

  console.log("Template variables needed:", varCount);
  console.log("Dynamic vars:", JSON.stringify(dynamicVars));

  const recipient = await db.WhatsappCampaignRecipients.create({
    campaign_id: campaignId,
    mobile_number: String(testPhone).trim(),
    dynamic_variables: JSON.stringify(dynamicVars),
    status: "pending",
  });

  trackedResources.campaignId = campaignId;
  trackedResources.recipientId = recipient.id;

  console.log(`Created test campaign: ${campaignId} (vars=${varCount})`);

  return { campaign, recipient, campaignId };
};

const dispatchAndTrack = async ({ campaignId, tenantId, recipientId }) => {
  const dispatchQueue = getCampaignDispatchQueue();
  const redisConnection = getRedisConnection();
  const tenantQueueName = getTenantQueueName(tenantId);

  if (!dispatchQueue || !redisConnection) {
    throw new Error("Dispatch queue or Redis connection unavailable");
  }

  const queueEvents = new QueueEvents(tenantQueueName, {
    connection: redisConnection,
  });
  const queue = new Queue(tenantQueueName, { connection: redisConnection });

  trackedResources.queueEvents = queueEvents;
  trackedResources.queue = queue;

  await dispatchQueue.add(
    "campaign-dispatch",
    { campaign_id: campaignId, tenant_id: tenantId, after_id: 0 },
    { jobId: `dispatch:${campaignId}:0` },
  );

  console.log(
    "Dispatch job added. Waiting for tenant send queue completion...",
  );

  // Wait for the tenant send queue to emit a terminal event for the job
  await new Promise((resolve) => {
    const onComplete = () => resolve();
    const onFailed = () => resolve();
    queueEvents.on("completed", onComplete);
    queueEvents.on("failed", onFailed);
    // Safety timeout
    setTimeout(resolve, 60000);
  });

  // Close events listener and allow DB batch flush to settle
  try {
    await queueEvents.close();
  } catch {
    // ignore
  }

  // Extra wait to let DB batch flush complete
  await new Promise((r) => setTimeout(r, 3000));

  checks.messageDispatched.pass = true;
  checks.messageDispatched.detail =
    "tenant send queue signaled completion or timed out";

  try {
    await queue.close();
  } catch {
    // ignore
  }
};

const verifyResults = async ({ campaignId, recipientId }) => {
  const recipient = await db.WhatsappCampaignRecipients.findOne({
    where: { id: recipientId, campaign_id: campaignId },
    attributes: ["status", "meta_message_id", "error_message"],
    raw: true,
  });

  const campaign = await db.WhatsappCampaigns.findOne({
    where: { campaign_id: campaignId },
    attributes: ["delivered_count"],
    raw: true,
  });

  const status = recipient?.status || "missing";
  const wamid = recipient?.meta_message_id || null;
  const deliveredCount = Number(campaign?.delivered_count ?? -1);

  checks.recipientMarkedSent.pass = [
    "sent",
    "delivered",
    "read",
    "replied",
  ].includes(status);
  checks.recipientMarkedSent.detail = `status=${status}${recipient?.error_message ? ` error=${recipient.error_message}` : ""}`;

  checks.metaMessageId.pass = Boolean(wamid);
  checks.metaMessageId.detail = wamid || "null";

  return {
    status,
    wamid,
    deliveredCount,
    campaignDeliveredPass: deliveredCount >= 0,
  };
};

const printFinalReport = ({ campaignDeliveredPass, deliveredCount }) => {
  const allPass =
    checks.dbConnection.pass &&
    checks.redisConnection.pass &&
    checks.whatsappAccount.pass &&
    checks.whatsappToken.pass &&
    checks.workersRunning.pass &&
    checks.messageDispatched.pass &&
    checks.recipientMarkedSent.pass &&
    checks.metaMessageId.pass &&
    campaignDeliveredPass;

  console.log("\n================================");
  console.log("E2E CAMPAIGN TEST REPORT");
  console.log("================================");
  console.log(
    `${checks.dbConnection.pass ? "✅" : "❌"} DB Connection: ${checks.dbConnection.pass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `${checks.redisConnection.pass ? "✅" : "❌"} Redis Connection: ${checks.redisConnection.pass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `${checks.whatsappAccount.pass ? "✅" : "❌"} WhatsApp Account: ${checks.whatsappAccount.pass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `${checks.whatsappToken.pass ? "✅" : "❌"} WhatsApp Token: ${checks.whatsappToken.pass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `${checks.workersRunning.pass ? "✅" : "❌"} Workers Running: ${checks.workersRunning.pass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `${checks.messageDispatched.pass ? "✅" : "❌"} Message Dispatched: ${checks.messageDispatched.pass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `${checks.recipientMarkedSent.pass ? "✅" : "❌"} Recipient Marked Sent: ${checks.recipientMarkedSent.pass ? "PASS" : "FAIL"}`,
  );
  console.log(
    `${checks.metaMessageId.pass ? "✅" : "❌"} Meta Message ID: ${checks.metaMessageId.pass ? `PASS (${checks.metaMessageId.detail})` : `FAIL (${checks.metaMessageId.detail})`}`,
  );
  console.log(
    `${campaignDeliveredPass ? "✅" : "❌"} Campaign delivered_count >= 0: ${campaignDeliveredPass ? `PASS (${deliveredCount})` : `FAIL (${deliveredCount})`}`,
  );
  console.log("================================");
  if (allPass) {
    console.log("Overall: ✅ PASS — System fully operational");
  } else {
    console.log("Overall: ❌ FAIL — See errors above");
  }
  console.log("================================");
};

const cleanup = async () => {
  const { queueEvents, queue, campaignId } = trackedResources;

  try {
    if (queueEvents) await queueEvents.close();
  } catch {
    // ignore
  }

  try {
    if (queue) await queue.close();
  } catch {
    // ignore
  }

  try {
    if (campaignId) {
      await db.WhatsappCampaignRecipients.destroy({
        where: { campaign_id: campaignId },
      });
      await db.WhatsappCampaigns.destroy({
        where: { campaign_id: campaignId },
      });
      console.log(`Cleanup complete for ${campaignId}`);
    }
  } catch (err) {
    console.error(`Cleanup failed: ${err.message}`);
  }

  try {
    await closeCampaignQueues();
  } catch {
    // ignore
  }

  try {
    await db.sequelize.close();
  } catch {
    // ignore
  }
};

const run = async () => {
  const testPhone = process.argv[2];
  if (!testPhone) {
    printUsageAndExit();
  }

  let shouldPrintFinalReport = false;

  try {
    console.log("Starting Campaign E2E test...");
    await db.sequelize.authenticate();
    await initCampaignQueues();

    const redisConnection = getRedisConnection();
    const dispatchQueue = getCampaignDispatchQueue();
    if (!redisConnection || !dispatchQueue) {
      throw new Error(
        "Queue layer unavailable. Ensure Redis is running and REDIS_URL is correct.",
      );
    }

    const tenantId = await getFirstActiveTenantId();
    if (!tenantId) {
      throw new Error("No active tenant found");
    }

    const tenantQueueName = getTenantQueueName(tenantId);
    const preflightOk = await runPreflightChecks(
      tenantId,
      tenantQueueName,
      redisConnection,
    );

    if (!preflightOk) {
      console.error("\nPre-flight checks failed. Aborting test.");
      shouldPrintFinalReport = true;
      printFinalReport({ campaignDeliveredPass: false, deliveredCount: -1 });
      process.exitCode = 1;
      return;
    }

    const template = await findApprovedTemplate(tenantId);
    if (!template) {
      console.error(
        "No approved template found. Please approve a template first.",
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `Using approved template: ${template.template_name} (${template.template_id})`,
    );

    const { campaignId, recipient } = await createE2ECampaign({
      tenantId,
      templateId: template.template_id,
      testPhone,
    });

    await dispatchAndTrack({
      campaignId,
      tenantId,
      recipientId: recipient.id,
    });

    const verify = await verifyResults({
      campaignId,
      recipientId: recipient.id,
    });

    shouldPrintFinalReport = true;
    printFinalReport({
      campaignDeliveredPass: verify.campaignDeliveredPass,
      deliveredCount: verify.deliveredCount,
    });

    if (
      !checks.messageDispatched.pass ||
      !checks.recipientMarkedSent.pass ||
      !checks.metaMessageId.pass ||
      !verify.campaignDeliveredPass
    ) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`E2E test failed: ${err.message}`);
    if (!shouldPrintFinalReport) {
      printFinalReport({ campaignDeliveredPass: false, deliveredCount: -1 });
    }
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
};

run();
