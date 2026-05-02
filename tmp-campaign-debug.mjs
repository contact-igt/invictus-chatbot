import db from "./src/database/index.js";
import {
  initCampaignQueues,
  isCampaignQueueAvailable,
  getCampaignDispatchQueue,
} from "./src/queues/campaignQueue.js";

const campaignId = "333";

try {
  await initCampaignQueues();

  const campaign = await db.WhatsappCampaigns.findOne({
    where: { campaign_id: campaignId },
    attributes: ["campaign_id", "tenant_id", "status", "scheduled_at", "is_deleted"],
    raw: true,
  });

  console.log("[DEBUG] campaign=", campaign);

  if (!isCampaignQueueAvailable()) {
    console.log("[DEBUG] queue unavailable, cannot enqueue manual dispatch");
    process.exit(0);
  }

  const queue = getCampaignDispatchQueue();
  const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
  console.log("[DEBUG] dispatch job counts=", counts);

  const jobs = await queue.getJobs(["waiting", "active", "delayed"], 0, 20, true);
  console.log(
    "[DEBUG] sample jobs=",
    jobs.map((j) => ({ id: j.id, name: j.name, data: j.data })),
  );

  if (campaign && campaign.tenant_id && !campaign.is_deleted) {
    const jobId = "dispatch:" + campaign.campaign_id + ":manualfix:" + Date.now();
    const job = await queue.add(
      "campaign-dispatch",
      {
        campaign_id: campaign.campaign_id,
        tenant_id: campaign.tenant_id,
        after_id: 0,
      },
      { jobId },
    );
    console.log("[DEBUG] enqueued manual dispatch job=", {
      id: job.id,
      name: job.name,
      jobId,
    });
  }
} catch (err) {
  console.error("[DEBUG] runtime check failed:", err?.message || err);
} finally {
  try {
    await db.sequelize.close();
  } catch {}
}
