import { logger } from "../utils/logger.js";
import { chunk } from "../utils/helpers.js";

// Enqueue send jobs in bulk using Queue.addBulk(), with chunking and fallback.
export async function enqueueSendJobs(sendQueue, campaign_id, tenant_id, recipients) {
  const DISPATCH_CHUNK_SIZE = parseInt(process.env.DISPATCH_CHUNK_SIZE || process.env.CAMPAIGN_DISPATCH_CHUNK_SIZE || "500", 10);
  const MAX_SEND_ATTEMPTS = parseInt(process.env.MAX_SEND_ATTEMPTS || "5", 10);
  const RETRY_BASE_MS = parseInt(process.env.RETRY_BASE_MS || "500", 10);
  const REMOVE_ON_COMPLETE = process.env.REMOVE_ON_COMPLETE ? Number(process.env.REMOVE_ON_COMPLETE) : 1000;
  const REMOVE_ON_FAIL = process.env.REMOVE_ON_FAIL ? Number(process.env.REMOVE_ON_FAIL) : 5000;

  const start = Date.now();

  // Prepare job descriptors in memory (no DB/queue calls here)
  const jobs = recipients.map((r) => ({
    name: "send-recipient",
    data: { campaign_id, tenant_id, recipient_id: r.id },
    opts: {
      attempts: MAX_SEND_ATTEMPTS,
      backoff: { type: "exponential", delay: RETRY_BASE_MS },
      removeOnComplete: REMOVE_ON_COMPLETE,
      removeOnFail: REMOVE_ON_FAIL,
      jobId: `send:${campaign_id}:${r.id}`,
    },
  }));

  const chunks = chunk(jobs, DISPATCH_CHUNK_SIZE);
  let totalEnqueued = 0;
  let totalFailed = 0;

  for (const [idx, jobChunk] of chunks.entries()) {
    try {
      // Queue.addBulk expects an array of job descriptors
      await sendQueue.addBulk(jobChunk);
      totalEnqueued += jobChunk.length;
      logger.info(`[DISPATCH] Enqueued chunk ${idx + 1}/${chunks.length} (${totalEnqueued}/${jobs.length})`);
    } catch (err) {
      // addBulk failed (Redis/connection/other) — fall back to per-job with dedupe handling
      logger.warn(`[DISPATCH] addBulk failed for chunk ${idx + 1}: ${err.message}. Falling back to per-job enqueue.`);
      for (const jobDef of jobChunk) {
        try {
          await sendQueue.add(jobDef.name, jobDef.data, jobDef.opts);
          totalEnqueued += 1;
        } catch (e) {
          // Duplicate job id or already exists is safe to ignore
          if (String(e.message || "").toLowerCase().includes("already exists")) {
            logger.debug(`[DISPATCH] Duplicate job ignored ${jobDef.opts.jobId}`);
            continue;
          }
          totalFailed += 1;
          logger.warn(`[DISPATCH] Failed to enqueue jobId=${jobDef.opts.jobId}: ${e.message}`);
        }
      }
      logger.info(`[DISPATCH] Chunk ${idx + 1} fallback completed: enqueued ${totalEnqueued} so far, failed ${totalFailed}`);
    }
  }

  const duration = Date.now() - start;
  logger.info(`[DISPATCH] Bulk enqueue complete: enqueued=${totalEnqueued} failed=${totalFailed} durationMs=${duration}`);
  return { totalEnqueued, totalFailed, durationMs: duration };
}
