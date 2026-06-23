import { logger } from "../utils/logger.js";

export const buildSendJobId = (campaign_id, recipient_id) =>
  `send:${campaign_id}:${recipient_id}`;

export const inspectSendJob = async (sendQueue, campaign_id, recipient_id) => {
  const jobId = buildSendJobId(campaign_id, recipient_id);
  const job = await sendQueue.getJob(jobId);

  if (!job) {
    return {
      jobId,
      found: false,
      removed: false,
      state: null,
    };
  }

  let state = "unknown";
  try {
    state = await job.getState();
  } catch (_) {
    state = "unknown";
  }

  return {
    jobId,
    found: true,
    removed: false,
    state,
    job,
  };
};

export const removeSendJobIfPresent = async (
  sendQueue,
  campaign_id,
  recipient_id,
  { logContext = "SEND-JOB" } = {},
) => {
  const inspection = await inspectSendJob(sendQueue, campaign_id, recipient_id);

  if (!inspection.found || !inspection.job) {
    return inspection;
  }

  try {
    await inspection.job.remove();
    logger.info(
      `[${logContext}] Removed existing send job ${inspection.jobId} state=${inspection.state}`,
    );
    return {
      ...inspection,
      removed: true,
      job: undefined,
    };
  } catch (err) {
    logger.warn(
      `[${logContext}] Could not remove existing send job ${inspection.jobId} state=${inspection.state}: ${err.message}`,
    );
    return {
      ...inspection,
      error: err.message,
      job: undefined,
    };
  }
};
