/**
 * Attachment Proxy Controller
 *
 * Proxies incoming user media (stored as "meta_media_id:{id}" in the messages table)
 * through our authenticated backend so the browser never needs a Meta access token.
 *
 * Implements full HTTP range-request support so that:
 *   - Video seek bar works (browser sends Range requests as the user scrubs)
 *   - Audio fast-forward works
 *   - Large MP4s start playing immediately on mobile (no full-file pre-load)
 *
 * Security:
 *   - Route is protected by authenticate + authorize middleware
 *   - Cache-Control: private — prevents shared CDN / device-cache leakage of
 *     per-tenant private media. Never use "public" here.
 */

import axios from "axios";
import db from "../../database/index.js";
import { tableNames } from "../../database/tableName.js";
import { getSecret } from "../TenantSecretsModel/tenantSecrets.service.js";

const META_API_VERSION = process.env.META_API_VERSION || "v23.0";

/**
 * Fetch the media URL + content-type from Meta's Graph API for a given mediaId.
 * Returns { url, mime_type, file_size } or throws on error.
 */
async function fetchMetaMediaInfo(mediaId, accessToken) {
  const response = await axios.get(
    `https://graph.facebook.com/${META_API_VERSION}/${mediaId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return {
    url: response.data.url,
    mime_type: response.data.mime_type || "application/octet-stream",
    file_size: response.data.file_size || null,
  };
}

/**
 * GET /api/whatsapp/attachments/proxy?mediaId=:id
 *
 * Streams Meta CDN media to the browser with proper range support.
 */
export const proxyMediaController = async (req, res) => {
  const { mediaId } = req.query;
  const tenant_id = req.user.tenant_id;

  if (!mediaId) {
    return res.status(400).send({ message: "mediaId is required" });
  }

  try {
    // Get tenant's WhatsApp access token
    const access_token = await getSecret(tenant_id, "whatsapp");
    if (!access_token) {
      return res.status(403).send({ message: "WhatsApp access token not found" });
    }

    // Resolve Meta media URL
    let mediaInfo;
    try {
      mediaInfo = await fetchMetaMediaInfo(mediaId, access_token);
    } catch (metaErr) {
      console.error("[PROXY] Failed to resolve Meta media URL:", metaErr.message);
      return res.status(404).send({ message: "Media not found or expired" });
    }

    const { url: metaUrl, mime_type, file_size } = mediaInfo;
    const rangeHeader = req.headers["range"];

    // ── RANGE REQUEST (206 Partial Content) ───────────────────────────────────
    // Browsers send "Range: bytes=start-end" when:
    //   - User scrubs a video seek bar
    //   - Audio player skips forward
    //   - Mobile browser requests chunks progressively
    if (rangeHeader) {
      // Parse "bytes=start-end"
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (!match) {
        return res.status(416).send({ message: "Invalid Range header" });
      }

      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : undefined;

      let metaResponse;
      try {
        metaResponse = await axios.get(metaUrl, {
          headers: {
            Authorization: `Bearer ${access_token}`,
            Range: rangeHeader,
          },
          responseType: "stream",
          timeout: 30_000,
        });
      } catch (fetchErr) {
        console.error("[PROXY] Meta CDN range fetch failed:", fetchErr.message);
        return res.status(502).send({ message: "Failed to fetch media from Meta" });
      }

      const metaStatus = metaResponse.status;
      const contentRange = metaResponse.headers["content-range"];
      const contentLength = metaResponse.headers["content-length"];
      const totalSize = file_size || (contentRange ? contentRange.split("/")[1] : "*");
      const chunkSize = contentLength || (end != null ? end - start + 1 : "");

      res.status(metaStatus === 206 ? 206 : 206);
      res.setHeader("Content-Type", mime_type);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (contentRange) {
        res.setHeader("Content-Range", contentRange);
      } else if (end != null) {
        res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
      }
      if (chunkSize) res.setHeader("Content-Length", chunkSize);

      metaResponse.data.pipe(res);
      return;
    }

    // ── FULL RESPONSE (200 OK) ────────────────────────────────────────────────
    let metaResponse;
    try {
      metaResponse = await axios.get(metaUrl, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
        responseType: "stream",
        timeout: 60_000,
      });
    } catch (fetchErr) {
      console.error("[PROXY] Meta CDN full fetch failed:", fetchErr.message);
      return res.status(502).send({ message: "Failed to fetch media from Meta" });
    }

    res.setHeader("Content-Type", mime_type);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");

    const contentLength = metaResponse.headers["content-length"] || file_size;
    if (contentLength) res.setHeader("Content-Length", contentLength);

    metaResponse.data.pipe(res);
  } catch (err) {
    console.error("[PROXY] Unexpected error:", err.message);
    return res.status(500).send({ message: "Media proxy error" });
  }
};
