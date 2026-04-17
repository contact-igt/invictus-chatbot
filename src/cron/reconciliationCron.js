import { reconcileMissingMessageBilling } from "../services/reconciliationService.js";
import { logger } from "../utils/logger.js";
import { recordBillingHealthEvent } from "../utils/healthEventService.js";

export const runMissingMessageBillingReconciliationCron = async () => {
  try {
    const result = await reconcileMissingMessageBilling();
    logger.info(
      `[RECONCILIATION-CRON] Completed missing billing reconciliation: unresolved=${result.unresolvedMessages}, missingLedger=${result.missingLedgerCount}, correlation_id=${result.correlationId}`,
    );
    return result;
  } catch (error) {
    logger.error(
      `[RECONCILIATION-CRON] Failed missing billing reconciliation: ${error.message}`,
    );
    await recordBillingHealthEvent({
      event_type: "reconciliation_report",
      tenant_id: null,
      error_message: `Missing message billing reconciliation cron failed: ${error.message}`,
      metadata: {
        stack: error.stack,
        code: error.code || null,
        fatal: Boolean(error.fatal),
      },
    });

    return {
      success: false,
      error: error.message,
      code: error.code || null,
    };
  }
};
