import db from "../database/index.js";
import { tableNames } from "../database/tableName.js";
import {
  buildBillingContext,
  createCorrelationId,
  logBillingEvent,
  recordBillingHealthEvent,
} from "../utils/healthEventService.js";

const DEFAULT_DELAY_MINUTES = Number(
  process.env.MESSAGE_BILLING_RECON_DELAY_MINUTES || 5,
);
const DEFAULT_BATCH_LIMIT = Number(
  process.env.MESSAGE_BILLING_RECON_BATCH_LIMIT || 200,
);

const buildThresholdDate = (delayMinutes) => {
  const threshold = new Date();
  threshold.setMinutes(threshold.getMinutes() - delayMinutes);
  return threshold;
};

export const resolveMessageBillingReconciliation = async (
  tenant_id,
  wamid,
  existingTransaction = null,
) => {
  if (!tenant_id || !wamid) {
    return false;
  }

  const performUpdate = async (transaction) => {
    const [affectedRows] = await db.Messages.update(
      {
        billing_reconciliation_status: "resolved",
        billing_reconciliation_checked_at: new Date(),
      },
      {
        where: { tenant_id, wamid },
        transaction,
      },
    );

    return affectedRows > 0;
  };

  if (existingTransaction) {
    return performUpdate(existingTransaction);
  }

  return performUpdate();
};

const markMessageAsUnresolvedBilling = async (message, correlationId) => {
  const context = buildBillingContext({
    tenant_id: message.tenant_id,
    message_id: message.id,
    wamid: message.wamid,
    correlation_id: correlationId,
  });

  const [affectedRows] = await db.Messages.update(
    {
      billing_reconciliation_status: "unresolved_billing",
      billing_reconciliation_checked_at: new Date(),
    },
    {
      where: {
        id: message.id,
        [db.Sequelize.Op.or]: [
          { billing_reconciliation_status: null },
          {
            billing_reconciliation_status: {
              [db.Sequelize.Op.ne]: "unresolved_billing",
            },
          },
        ],
      },
    },
  );

  if (affectedRows > 0) {
    await recordBillingHealthEvent({
      event_type: "missing_message_billing",
      tenant_id: message.tenant_id,
      error_message: `Outbound message ${message.wamid} is missing billing artifacts after reconciliation delay.`,
      metadata: {
        message_row_id: message.id,
      },
      context,
    });

    logBillingEvent(
      "warn",
      "[RECONCILIATION] Missing message billing detected",
      context,
    );
  }

  return affectedRows > 0;
};

const recordMissingLedgerForUsage = async (usageRow, correlationId) => {
  const context = buildBillingContext({
    tenant_id: usageRow.tenant_id,
    message_id: usageRow.message_id,
    wamid: usageRow.message_id,
    correlation_id: correlationId,
  });

  await recordBillingHealthEvent({
    event_type: "missing_ledger_detected",
    tenant_id: usageRow.tenant_id,
    error_message: `message_usage row ${usageRow.id} is missing its billing_ledger entry.`,
    metadata: {
      usage_row_id: usageRow.id,
    },
    context,
  });

  await db.Messages.update(
    {
      billing_reconciliation_status: "unresolved_billing",
      billing_reconciliation_checked_at: new Date(),
    },
    {
      where: {
        tenant_id: usageRow.tenant_id,
        wamid: usageRow.message_id,
      },
    },
  );

  logBillingEvent(
    "warn",
    "[RECONCILIATION] Missing ledger detected for existing usage row",
    context,
  );
};

export const reconcileMissingMessageBilling = async ({
  delayMinutes = DEFAULT_DELAY_MINUTES,
  limit = DEFAULT_BATCH_LIMIT,
} = {}) => {
  const correlationId = createCorrelationId("reconcile_msg_billing");
  const thresholdDate = buildThresholdDate(delayMinutes);

  const [missingMessageRows] = await db.sequelize.query(
    `
      SELECT m.id, m.wamid, m.tenant_id, m.created_at
      FROM ${tableNames.MESSAGES} m
      LEFT JOIN ${tableNames.MESSAGE_USAGE} mu
        ON mu.message_id = m.wamid
      WHERE m.sender IN ('admin', 'bot')
        AND m.wamid IS NOT NULL
        AND m.is_deleted = false
        AND mu.id IS NULL
        AND m.created_at < ?
        AND (m.billing_reconciliation_status IS NULL OR m.billing_reconciliation_status <> 'unresolved_billing')
      ORDER BY m.created_at ASC
      LIMIT ?
    `,
    {
      replacements: [thresholdDate, limit],
    },
  );

  const [missingLedgerRows] = await db.sequelize.query(
    `
      SELECT mu.id, mu.message_id, mu.tenant_id, mu.created_at
      FROM ${tableNames.MESSAGE_USAGE} mu
      LEFT JOIN ${tableNames.BILLING_LEDGER} bl
        ON bl.message_usage_id = mu.id
      WHERE bl.id IS NULL
        AND mu.created_at < ?
      ORDER BY mu.created_at ASC
      LIMIT ?
    `,
    {
      replacements: [thresholdDate, limit],
    },
  );

  let unresolvedMessages = 0;
  for (const message of missingMessageRows) {
    if (await markMessageAsUnresolvedBilling(message, correlationId)) {
      unresolvedMessages++;
    }
  }

  let missingLedgerCount = 0;
  for (const usageRow of missingLedgerRows) {
    await recordMissingLedgerForUsage(usageRow, correlationId);
    missingLedgerCount++;
  }

  logBillingEvent(
    "info",
    "[RECONCILIATION] Missing message billing reconciliation completed",
    buildBillingContext({ correlation_id: correlationId }),
    {
      thresholdDate: thresholdDate.toISOString(),
      unresolvedMessages,
      missingLedgerCount,
    },
  );

  return {
    checkedBefore: thresholdDate.toISOString(),
    unresolvedMessages,
    missingLedgerCount,
    correlationId,
  };
};
