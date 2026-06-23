import db from "../database/index.js";
import {
  closeCampaignQueues,
  initCampaignQueues,
  isCampaignQueueAvailable,
} from "../queues/campaignQueue.js";
import {
  closeDispatchWorker,
  startCampaignDispatchWorker,
} from "../workers/campaignDispatchWorker.js";
import {
  closeSendWorker,
  ensureTenantSendWorker,
  startCampaignSendWorker,
} from "../workers/campaignSendWorker.js";
import { logger } from "../utils/logger.js";

const startCampaignWorkers = async () => {
  await initCampaignQueues();

  if (!isCampaignQueueAvailable()) {
    logger.error(
      "[CAMPAIGN-WORKERS] Redis/BullMQ unavailable. Check REDIS_URL and Redis service.",
    );
    process.exitCode = 1;
    return;
  }

  startCampaignDispatchWorker();
  startCampaignSendWorker();

  const tenants = await db.Tenants.findAll({
    where: { is_deleted: false },
    attributes: ["tenant_id"],
    raw: true,
  });

  for (const tenant of tenants) {
    ensureTenantSendWorker(tenant.tenant_id);
  }

  logger.info(
    `[CAMPAIGN-WORKERS] Started dispatch worker and ${tenants.length} tenant send worker(s)`,
  );
};

const shutdown = async () => {
  try {
    await closeSendWorker();
    await closeDispatchWorker();
    await closeCampaignQueues();
    await db.sequelize.close();
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startCampaignWorkers().catch(async (err) => {
  logger.error(`[CAMPAIGN-WORKERS] Failed to start: ${err.stack || err.message}`);
  try {
    await closeSendWorker();
    await closeDispatchWorker();
    await closeCampaignQueues();
    await db.sequelize.close();
  } catch {
    // ignore shutdown errors
  }
  process.exit(1);
});
