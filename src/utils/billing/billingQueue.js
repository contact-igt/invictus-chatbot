/**
 * Asynchronous billing queue using Bull (optional — requires Redis).
 * Falls back to synchronous processing if Redis is unavailable.
 */

let Queue;
let billingQueue = null;
let queueAvailable = false;

/**
 * Initialize the billing queue.
 * Call once at app startup. Safe to call even if Redis is down.
 */
export const initBillingQueue = async () => {
  try {
    // Dynamic import — Bull is an optional dependency
    const BullModule = await import("bull");
    Queue = BullModule.default || BullModule;

    const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

    billingQueue = new Queue("billing-processing", redisUrl, {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 10000 },
        removeOnFail: { count: 5000 },
      },
    });

    // Test connection
    await billingQueue.isReady();
    queueAvailable = true;

    console.log("[BILLING-QUEUE] Initialized successfully with Redis");

    // Set up worker
    billingQueue.process(5, async (job) => {
      const { processBillingFromWebhook } =
        await import("../../models/BillingModel/billing.service.js");
      await processBillingFromWebhook(
        job.data.tenant_id,
        job.data.statusUpdate,
      );
    });

    billingQueue.on("failed", (job, err) => {
      console.error(
        `[BILLING-QUEUE] Job ${job.id} failed (attempt ${job.attemptsMade}):`,
        err.message,
      );
    });

    billingQueue.on("error", (error) => {
      console.error("[BILLING-QUEUE] Queue error:", error.message);
    });
  } catch (err) {
    queueAvailable = false;
    console.warn(
      "[BILLING-QUEUE] Redis not available — queue disabled, using sync processing.",
      err.message,
    );
  }
};

/**
 * Enqueue a billing job. Falls back to sync if queue is unavailable.
 *
 * @param {string} tenant_id
 * @param {object} statusUpdate - Meta webhook status update object
 * @returns {Promise<boolean>} true if enqueued, false if processed synchronously
 */
export const enqueueBillingJob = async (tenant_id, statusUpdate) => {
  if (queueAvailable && billingQueue) {
    try {
      await billingQueue.add(
        { tenant_id, statusUpdate, received_at: new Date().toISOString() },
        { jobId: `billing_${statusUpdate.id}_${Date.now()}` },
      );
      return true;
    } catch (err) {
      console.error(
        "[BILLING-QUEUE] Enqueue failed, falling back to sync:",
        err.message,
      );
    }
  }

  // Sync fallback
  const { processBillingFromWebhook } =
    await import("../../models/BillingModel/billing.service.js");
  await processBillingFromWebhook(tenant_id, statusUpdate);
  return false;
};

/**
 * Check if the billing queue is operational.
 */
export const isQueueAvailable = () => queueAvailable;

/**
 * Get queue statistics.
 */
export const getQueueStats = async () => {
  if (!queueAvailable || !billingQueue) {
    return { available: false };
  }

  try {
    const [waiting, active, completed, failed] = await Promise.all([
      billingQueue.getWaitingCount(),
      billingQueue.getActiveCount(),
      billingQueue.getCompletedCount(),
      billingQueue.getFailedCount(),
    ]);

    return { available: true, waiting, active, completed, failed };
  } catch (err) {
    return { available: false, error: err.message };
  }
};

/**
 * Gracefully close the queue (for shutdown).
 */
export const closeBillingQueue = async () => {
  if (billingQueue) {
    await billingQueue.close();
    console.log("[BILLING-QUEUE] Closed gracefully");
  }
};
