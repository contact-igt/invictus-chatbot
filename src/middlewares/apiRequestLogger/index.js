import { randomUUID } from "crypto";

import db from "../../database/index.js";
import { getIO } from "../socket/socket.js";
import { logger } from "../../utils/logger.js";
import {
  getClientIp,
  lookupGeoFromIp,
  parseUserAgent,
} from "../../utils/apiRequestLogEnrichment.js";

const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "otp",
  "secret",
  "api_key",
  "apikey",
  "key",
  "file",
  "image",
  "attachment",
  "media",
  "base64",
]);

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "otp",
  "secret",
  "api_key",
  "apikey",
  "key",
]);

const MAX_ERROR_MESSAGE_LENGTH = 500;
const MANAGEMENT_API_LOGS_ROOM = "management:api-request-logs";
const API_REQUEST_LOG_CREATED_EVENT = "api-request-log:created";

const getHeaderValue = (value) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return value || null;
};

const normalizeKey = (key) => String(key || "").trim().toLowerCase();

const truncateSafeText = (text) => {
  const value = String(text || "").trim();
  if (!value) return null;
  return value.length > MAX_ERROR_MESSAGE_LENGTH
    ? value.slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : value;
};

const looksSensitiveText = (text) => {
  const value = String(text || "").toLowerCase();
  return (
    value.includes("password=") ||
    value.includes("access_token=") ||
    value.includes("refresh_token=") ||
    value.includes("authorization:") ||
    value.includes("bearer ") ||
    value.includes("secret=") ||
    value.includes("api_key=") ||
    value.includes("apikey=") ||
    value.includes("base64") ||
    value.includes("stack trace") ||
    value.includes("<html")
  );
};

const extractSafeErrorMessage = (payload) => {
  const inspectValue = (value) => {
    const normalized = truncateSafeText(value);
    if (!normalized) return null;
    if (looksSensitiveText(normalized)) return null;
    if (/^\{.*\}$/.test(normalized) || /^\[.*\]$/.test(normalized)) return null;
    return normalized;
  };

  try {
    if (payload == null) return null;

    if (Buffer.isBuffer(payload)) {
      const asText = payload.toString("utf8").trim();
      if (!asText || asText.length > MAX_ERROR_MESSAGE_LENGTH) return null;
      if (looksSensitiveText(asText)) return null;
      if (asText.startsWith("{") || asText.startsWith("[")) {
        try {
          return extractSafeErrorMessage(JSON.parse(asText));
        } catch {
          return null;
        }
      }
      return inspectValue(asText);
    }

    if (typeof payload === "string") {
      const text = payload.trim();
      if (!text || text.length > MAX_ERROR_MESSAGE_LENGTH) return null;
      if (looksSensitiveText(text)) return null;
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          return extractSafeErrorMessage(JSON.parse(text));
        } catch {
          return null;
        }
      }
      return inspectValue(text);
    }

    if (typeof payload !== "object") {
      return null;
    }

    const messageFields = [
      payload.message,
      payload.error,
      payload.error_message,
      payload.errorMessage,
    ];
    for (const field of messageFields) {
      const extracted = inspectValue(field);
      if (extracted) return extracted;
    }

    if (Array.isArray(payload.errors)) {
      for (const entry of payload.errors) {
        const nestedMessage =
          typeof entry === "string"
            ? inspectValue(entry)
            : inspectValue(entry?.message || entry?.error || entry?.error_message);
        if (nestedMessage) return nestedMessage;
      }
    }

    if (Array.isArray(payload.error)) {
      for (const entry of payload.error) {
        const nestedMessage =
          typeof entry === "string"
            ? inspectValue(entry)
            : inspectValue(entry?.message || entry?.error || entry?.error_message);
        if (nestedMessage) return nestedMessage;
      }
    }

    if (typeof payload === "object") {
      const safeKeys = Object.keys(payload).filter(
        (key) => !SENSITIVE_BODY_KEYS.has(normalizeKey(key)),
      );

      if (
        safeKeys.length === 1 &&
        typeof payload[safeKeys[0]] === "string" &&
        payload[safeKeys[0]].trim().length > 0
      ) {
        return inspectValue(payload[safeKeys[0]]);
      }
    }

    return null;
  } catch {
    return null;
  }
};

const sanitizeQuery = (query = {}) => {
  const entries = Object.entries(query || {});
  if (entries.length === 0) return null;

  const sanitized = {};
  for (const [key, value] of entries) {
    if (SENSITIVE_QUERY_KEYS.has(normalizeKey(key))) {
      sanitized[key] = "[REDACTED]";
      continue;
    }

    if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        typeof item === "object" && item !== null ? "[OBJECT]" : item,
      );
      continue;
    }

    if (value && typeof value === "object") {
      sanitized[key] = "[OBJECT]";
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
};

const getSafeBodyKeys = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }

  return Object.keys(body).filter(
    (key) => !SENSITIVE_BODY_KEYS.has(normalizeKey(key)),
  );
};

const detectModule = (originalUrl = "") => {
  const url = String(originalUrl).toLowerCase();

  if (url.includes("webhook")) return "webhook";
  if (url.includes("billing")) return "billing";
  if (url.includes("campaign")) return "campaign";
  if (
    url.includes("login") ||
    url.includes("auth") ||
    url.includes("otp") ||
    url.includes("verify")
  ) {
    return "auth";
  }
  if (url.includes("dashboard")) return "dashboard";
  if (url.startsWith("/api/management")) return "management";
  if (url.startsWith("/api/tenant")) return "tenant";
  if (url.includes("whatsapp")) return "whatsapp";

  return "unknown";
};

const getRoutePath = (req) => {
  if (!req?.route?.path) return null;
  return `${req.baseUrl || ""}${req.route.path}`;
};

const getActorContext = (req) => {
  const user = req.user || null;
  const originalUrl = String(req.originalUrl || "");
  const isWebhook = originalUrl.toLowerCase().includes("webhook");

  if (isWebhook) {
    const tenantId =
      user?.tenant_id ||
      req.params?.tenant_id ||
      req.params?.tenantId ||
      req.query?.tenant_id ||
      req.query?.tenantId ||
      req.body?.tenant_id ||
      req.body?.tenantId ||
      req.body?.organization_id ||
      req.body?.client_id ||
      null;

    return {
      actor_type: "webhook",
      user_id: user?.unique_id || user?.management_id || user?.tenant_user_id || user?.id || null,
      tenant_id: tenantId,
      actor_role: user?.role || null,
      actor_name: user?.name || user?.username || null,
      actor_email: user?.email || null,
      user_type: null,
    };
  }

  if (user?.user_type === "management") {
    return {
      actor_type: "management",
      user_id: user?.unique_id || user?.management_id || user?.id || null,
      tenant_id: null,
      actor_role: user?.role || null,
      actor_name: user?.name || user?.username || null,
      actor_email: user?.email || null,
      user_type: "management",
    };
  }

  if (user?.user_type === "tenant") {
    return {
      actor_type: "tenant",
      user_id: user?.unique_id || user?.tenant_user_id || user?.id || null,
      tenant_id: user?.tenant_id || null,
      actor_role: user?.role || null,
      actor_name: user?.name || user?.username || null,
      actor_email: user?.email || null,
      user_type: "tenant",
    };
  }

  return {
    actor_type: req.res?.statusCode === 401 || req.res?.statusCode === 403 ? "unknown" : "anonymous",
    user_id: null,
    tenant_id: null,
    actor_role: null,
    actor_name: null,
    actor_email: null,
    user_type: null,
  };
};

const mapApiRequestLogPayload = (log) => {
  const plainLog =
    typeof log?.get === "function" ? log.get({ plain: true }) : log || {};

  return {
    id: plainLog.id,
    request_id: plainLog.request_id,
    tenant_id: plainLog.tenant_id,
    user_id: plainLog.user_id,
    actor_type: plainLog.actor_type,
    actor_name: plainLog.actor_name,
    actor_email: plainLog.actor_email,
    actor_role: plainLog.actor_role,
    user_type: plainLog.user_type,
    method: plainLog.method,
    original_url: plainLog.original_url,
    route_path: plainLog.route_path,
    module: plainLog.module,
    status_code: plainLog.status_code,
    success: plainLog.success,
    duration_ms: plainLog.duration_ms,
    ip_address: plainLog.ip_address,
    forwarded_for: plainLog.forwarded_for,
    country: plainLog.country,
    region: plainLog.region,
    city: plainLog.city,
    latitude: plainLog.latitude,
    longitude: plainLog.longitude,
    timezone: plainLog.timezone,
    isp: plainLog.isp,
    user_agent: plainLog.user_agent,
    browser: plainLog.browser,
    browser_version: plainLog.browser_version,
    os: plainLog.os,
    os_version: plainLog.os_version,
    device_type: plainLog.device_type,
    device_vendor: plainLog.device_vendor,
    device_model: plainLog.device_model,
    referer: plainLog.referer,
    origin: plainLog.origin,
    accept_language: plainLog.accept_language,
    query_json: plainLog.query_json,
    body_keys_json: plainLog.body_keys_json,
    metadata_json: plainLog.metadata_json,
    error_message: plainLog.error_message,
    created_at: plainLog.createdAt || plainLog.created_at || null,
    updated_at: plainLog.updatedAt || plainLog.updated_at || null,
  };
};

export const apiRequestLogger = (req, res, next) => {
  const originalUrl = String(req.originalUrl || "");

  if (!originalUrl.startsWith("/api")) {
    return next();
  }

  const requestId = req.headers["x-request-id"] || randomUUID();
  req.request_id = requestId;
  res.locals.request_id = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  const captureResponseErrorMessage = (payload) => {
    try {
      if ((res.statusCode || 0) < 400) {
        return;
      }

      if (res.locals.errorMessage) {
        return;
      }

      const extracted = extractSafeErrorMessage(payload);
      if (extracted) {
        res.locals.errorMessage = extracted;
      }
    } catch {
      // Never let logging helpers affect the response path.
    }
  };

  res.json = (payload) => {
    captureResponseErrorMessage(payload);
    return originalJson(payload);
  };

  res.send = (payload) => {
    captureResponseErrorMessage(payload);
    return originalSend(payload);
  };

  res.on("finish", () => {
    void (async () => {
      try {
        if (!db?.ApiRequestLogs) {
          return;
        }

        const statusCode = Number(res.statusCode) || null;
        const actorContext = getActorContext(req);
        const safeQuery = sanitizeQuery(req.query);
        const safeBodyKeys = getSafeBodyKeys(req.body);
        const errorMessage =
          res.locals.errorMessage ||
          (statusCode && statusCode >= 400 ? res.statusMessage || null : null);
        const routePath = getRoutePath(req);
        const userAgent = req.headers["user-agent"] || null;
        const ipContext = getClientIp(req);
        const userAgentContext = parseUserAgent(userAgent);
        const geoContext = lookupGeoFromIp(ipContext.ip_address);
        const tenantId =
          actorContext.tenant_id ||
          req.user?.tenant_id ||
          req.params?.tenant_id ||
          req.query?.tenant_id ||
          req.body?.tenant_id ||
          req.body?.organization_id ||
          req.body?.client_id ||
          null;

        const createdLog = await db.ApiRequestLogs.create({
          request_id: requestId,
          tenant_id: tenantId,
          user_id: actorContext.user_id,
          actor_type: actorContext.actor_type,
          actor_name: actorContext.actor_name,
          actor_email: actorContext.actor_email,
          actor_role: actorContext.actor_role,
          user_type: actorContext.user_type,
          method: req.method,
          original_url: originalUrl,
          route_path: routePath,
          module: detectModule(originalUrl),
          status_code: statusCode,
          success: statusCode >= 200 && statusCode < 400,
          duration_ms: Date.now() - startedAt,
          ip_address: ipContext.ip_address,
          forwarded_for: ipContext.forwarded_for,
          country: geoContext.country,
          region: geoContext.region,
          city: geoContext.city,
          latitude: geoContext.latitude,
          longitude: geoContext.longitude,
          timezone: geoContext.timezone,
          isp: geoContext.isp,
          user_agent: userAgent,
          browser: userAgentContext.browser,
          browser_version: userAgentContext.browser_version,
          os: userAgentContext.os,
          os_version: userAgentContext.os_version,
          device_type: userAgentContext.device_type,
          device_vendor: userAgentContext.device_vendor,
          device_model: userAgentContext.device_model,
          referer: req.headers.referer || null,
          origin: req.headers.origin || null,
          accept_language: req.headers["accept-language"] || null,
          query_json: safeQuery,
          body_keys_json: safeBodyKeys,
          metadata_json: {
            request_id: requestId,
            params: req.params || null,
            response_content_type: getHeaderValue(res.getHeader("content-type")),
            authenticated: Boolean(req.user),
            has_query: Object.keys(req.query || {}).length > 0,
            has_body:
              req.body &&
              typeof req.body === "object" &&
              !Array.isArray(req.body) &&
              Object.keys(req.body).length > 0,
          },
          error_message: errorMessage,
        });

        try {
          const io = getIO();
          io.to(MANAGEMENT_API_LOGS_ROOM).emit(
            API_REQUEST_LOG_CREATED_EVENT,
            mapApiRequestLogPayload(createdLog),
          );
        } catch (socketError) {
          logger.warn(
            `[API-REQUEST-LOG] Socket emit failed for request ${requestId}: ${socketError.message}`,
          );
        }
      } catch (err) {
        logger.warn(
          `[API-REQUEST-LOG] Failed to persist request ${requestId}: ${err.message}`,
        );
      }
    })();
  });

  return next();
};
