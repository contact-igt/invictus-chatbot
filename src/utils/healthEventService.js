import crypto from "crypto";
import { logger } from "./logger.js";
import { recordHealthEvent } from "./billing/billingHealthMonitor.js";

export const createCorrelationId = (prefix = "billing") => {
  if (typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const buildBillingContext = ({
  tenant_id = null,
  message_id = null,
  wamid = null,
  pricing_version = null,
  correlation_id = null,
} = {}) => ({
  tenant_id,
  message_id,
  wamid,
  pricing_version,
  correlation_id,
});

export const formatBillingContext = (context = {}) =>
  Object.entries(context)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    )
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");

export const logBillingEvent = (
  level,
  message,
  context = {},
  extraMetadata = null,
) => {
  const formattedContext = formatBillingContext(context);
  const finalMessage = formattedContext
    ? `${message} | ${formattedContext}`
    : message;

  if (extraMetadata) {
    logger[level](finalMessage, extraMetadata);
    return;
  }

  logger[level](finalMessage);
};

export const recordBillingHealthEvent = async ({
  event_type,
  tenant_id = null,
  error_message = "",
  metadata = {},
  context = {},
}) => {
  const mergedMetadata = {
    ...buildBillingContext(context),
    ...metadata,
  };

  await recordHealthEvent(event_type, tenant_id, error_message, mergedMetadata);
};
