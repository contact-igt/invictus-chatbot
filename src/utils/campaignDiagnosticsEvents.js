const MAX_EVENTS = 20;
const eventBuffer = [];

export const recordCampaignDiagnosticEvent = ({
  source,
  type,
  message,
  level = "info",
  meta = {},
}) => {
  const event = {
    timestamp: new Date().toISOString(),
    source: source || "campaign",
    type: type || "event",
    level,
    message: String(message || ""),
    meta: meta || {},
  };

  eventBuffer.push(event);
  if (eventBuffer.length > MAX_EVENTS) {
    eventBuffer.splice(0, eventBuffer.length - MAX_EVENTS);
  }

  return event;
};

export const getCampaignDiagnosticEvents = (limit = MAX_EVENTS) => {
  const n = Math.max(1, Math.min(MAX_EVENTS, Number(limit) || MAX_EVENTS));
  return eventBuffer.slice(-n).reverse();
};

export const clearCampaignDiagnosticEvents = () => {
  eventBuffer.length = 0;
};
