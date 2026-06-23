import { isIP } from "node:net";

import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";

const IPV6_MAPPED_IPV4_PREFIX = "::ffff:";

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
];

const LOCAL_IPV6_PATTERNS = [
  /^::1$/i,
  /^fc/i,
  /^fd/i,
  /^fe8/i,
  /^fe9/i,
  /^fea/i,
  /^feb/i,
];

const toNullableString = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

export const normalizeIp = (ipAddress) => {
  const rawValue = toNullableString(ipAddress);
  if (!rawValue) return null;

  if (/^localhost$/i.test(rawValue)) {
    return "localhost";
  }

  if (rawValue.startsWith(IPV6_MAPPED_IPV4_PREFIX)) {
    return rawValue.slice(IPV6_MAPPED_IPV4_PREFIX.length);
  }

  return rawValue;
};

export const isPrivateOrLocalIp = (ipAddress) => {
  const normalizedIp = normalizeIp(ipAddress);
  if (!normalizedIp) return true;

  if (/^localhost$/i.test(normalizedIp)) return true;

  const ipVersion = isIP(normalizedIp);
  if (!ipVersion) return true;

  if (ipVersion === 4) {
    return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(normalizedIp));
  }

  return LOCAL_IPV6_PATTERNS.some((pattern) => pattern.test(normalizedIp));
};

export const getClientIp = (req) => {
  const forwardedForHeader = req?.headers?.["x-forwarded-for"];
  const forwardedFor = Array.isArray(forwardedForHeader)
    ? forwardedForHeader.find(Boolean) || null
    : forwardedForHeader || null;

  const forwardedIp = toNullableString(forwardedFor?.split(",")[0]);
  const realIp = toNullableString(req?.headers?.["x-real-ip"]);
  const cloudflareIp = toNullableString(req?.headers?.["cf-connecting-ip"]);
  const requestIp = toNullableString(req?.ip);
  const socketIp = toNullableString(req?.socket?.remoteAddress);

  const ipAddress =
    normalizeIp(forwardedIp) ||
    normalizeIp(realIp) ||
    normalizeIp(cloudflareIp) ||
    normalizeIp(requestIp) ||
    normalizeIp(socketIp) ||
    null;

  return {
    ip_address: ipAddress,
    forwarded_for: toNullableString(forwardedFor),
  };
};

export const parseUserAgent = (userAgent) => {
  const rawUserAgent = toNullableString(userAgent);
  if (!rawUserAgent) {
    return {
      browser: null,
      browser_version: null,
      os: null,
      os_version: null,
      device_type: null,
      device_vendor: null,
      device_model: null,
    };
  }

  try {
    const parser = new UAParser(rawUserAgent);
    const result = parser.getResult();
    const deviceType = toNullableString(result?.device?.type);

    return {
      browser: toNullableString(result?.browser?.name),
      browser_version: toNullableString(result?.browser?.version),
      os: toNullableString(result?.os?.name),
      os_version: toNullableString(result?.os?.version),
      device_type: deviceType === "smarttv" ? "tv" : deviceType,
      device_vendor: toNullableString(result?.device?.vendor),
      device_model: toNullableString(result?.device?.model),
    };
  } catch {
    return {
      browser: null,
      browser_version: null,
      os: null,
      os_version: null,
      device_type: null,
      device_vendor: null,
      device_model: null,
    };
  }
};

export const lookupGeoFromIp = (ipAddress) => {
  const normalizedIp = normalizeIp(ipAddress);
  if (!normalizedIp || isPrivateOrLocalIp(normalizedIp)) {
    return {
      country: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      timezone: null,
      isp: null,
    };
  }

  try {
    const geo = geoip.lookup(normalizedIp);
    if (!geo) {
      return {
        country: null,
        region: null,
        city: null,
        latitude: null,
        longitude: null,
        timezone: null,
        isp: null,
      };
    }

    return {
      country: toNullableString(geo.country),
      region: toNullableString(geo.region),
      city: toNullableString(geo.city),
      latitude:
        typeof geo.ll?.[0] === "number" ? String(geo.ll[0]) : null,
      longitude:
        typeof geo.ll?.[1] === "number" ? String(geo.ll[1]) : null,
      timezone: toNullableString(geo.timezone),
      isp: null,
    };
  } catch {
    return {
      country: null,
      region: null,
      city: null,
      latitude: null,
      longitude: null,
      timezone: null,
      isp: null,
    };
  }
};
