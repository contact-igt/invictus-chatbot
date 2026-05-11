import crypto from "crypto";
import path from "path";
import { spawn } from "child_process";
import { createRequire } from "module";
import sharp from "sharp";
import axios from "axios";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSecret } from "../models/TenantSecretsModel/tenantSecrets.service.js";

const _require = createRequire(import.meta.url);
const ffmpegPath = _require("ffmpeg-static");

/**
 * Convert any audio buffer to audio/mpeg (MP3) using ffmpeg.
 * Used to convert audio/webm (Chrome MediaRecorder output) to a WhatsApp-compatible format.
 * Uses stdin/stdout pipes — no temp files written to disk.
 */
export async function transcodeAudioToMp3(inputBuffer) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn(ffmpegPath, [
      "-i", "pipe:0",
      "-vn",
      "-c:a", "libmp3lame",
      "-q:a", "3",
      "-f", "mp3",
      "pipe:1",
    ]);
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stdout.on("end", () => {
      const result = Buffer.concat(chunks);
      if (result.length === 0) return reject(new Error("ffmpeg produced empty output"));
      resolve(result);
    });
    proc.stderr.on("data", () => {});
    proc.on("error", reject);
    proc.stdin.on("error", () => {});
    proc.stdin.write(inputBuffer);
    proc.stdin.end();
  });
}

// ─── Allowed types for chat attachments ───────────────────────────────────────
// Separate from mediaValidation.js (which covers gallery/template uploads only).

const CHAT_ALLOWED = {
  image: {
    mimes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    exts: ["jpg", "jpeg", "png", "webp", "gif"],
    maxBytes: 5 * 1024 * 1024, // 5 MB
  },
  video: {
    mimes: ["video/mp4", "video/webm"],
    exts: ["mp4", "webm"],
    maxBytes: 16 * 1024 * 1024, // 16 MB
  },
  audio: {
    mimes: ["audio/mpeg", "audio/wav", "audio/webm", "audio/ogg", "audio/mp4", "audio/aac"],
    exts: ["mp3", "wav", "webm", "ogg", "m4a", "aac"],
    maxBytes: 16 * 1024 * 1024, // 16 MB
  },
  document: {
    mimes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ],
    exts: ["pdf", "doc", "docx", "xls", "xlsx", "txt"],
    maxBytes: 25 * 1024 * 1024, // 25 MB
  },
};

// Extensions that are never allowed regardless of MIME type
const BLOCKED_EXTS = new Set([".exe", ".bat", ".cmd", ".sh", ".apk", ".ps1", ".vbs"]);

// ─── In-memory rate limiter ────────────────────────────────────────────────────
// Simple per-tenant window. TODO: Redis rate limit for multi-instance deployments.
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_FILES = 10;

function checkRateLimit(tenantId) {
  const now = Date.now();
  const record = rateLimitMap.get(tenantId);
  if (!record || now - record.windowStart > RATE_WINDOW_MS) {
    rateLimitMap.set(tenantId, { count: 1, windowStart: now });
    return true;
  }
  if (record.count >= RATE_MAX_FILES) return false;
  record.count++;
  return true;
}

// ─── R2 client (same credentials as storageService.js) ───────────────────────
const s3Client = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ─── Virus scan hook ──────────────────────────────────────────────────────────
// No-op placeholder. Replace with ClamAV / async moderation queue when ready.
async function runVirusScan(_buffer, _fileName) {
  // TODO: pipe buffer to ClamAV daemon via clamdjs, or enqueue to async moderation queue.
  // For now: pass-through. Extension blocking above is the production safety net.
  return { clean: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getExt(fileName) {
  return path.extname(String(fileName || "")).toLowerCase();
}

function detectFileType(mimeType, ext) {
  // Normalize MIME: strip codec params (e.g. "audio/webm;codecs=opus" → "audio/webm")
  const normalizedMime = (mimeType || "").split(";")[0].trim().toLowerCase();
  const bare = (ext || "").replace(/^\./, "").toLowerCase();

  // MIME-first: exact match after normalization wins unconditionally
  for (const [type, cfg] of Object.entries(CHAT_ALLOWED)) {
    if (cfg.mimes.some((m) => m.toLowerCase() === normalizedMime)) return type;
  }

  // Extension fallback — use MIME family as tiebreaker for ambiguous extensions (e.g. ".webm")
  const mimeFamily = normalizedMime.split("/")[0]; // "audio", "video", "image", …
  const extMatches = Object.entries(CHAT_ALLOWED)
    .filter(([, cfg]) => cfg.exts.includes(bare))
    .map(([t]) => t);
  if (extMatches.length === 0) return null;
  if (extMatches.length === 1) return extMatches[0];
  if (extMatches.includes(mimeFamily)) return mimeFamily;
  return extMatches[0];
}

function sanitizeFilename(originalName) {
  const ext = getExt(originalName);
  const base = path
    .basename(originalName, ext)
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toLowerCase()
    .slice(0, 40);
  const id = crypto.randomUUID();
  return { sanitizedName: `${id}-${base}${ext}`, ext };
}

async function r2Put(key, buffer, contentType) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000",
    }),
  );
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a chat file (from express-fileupload req.files).
 * Returns { valid, error, fileType }.
 * Does NOT touch storage — safe to call before any upload.
 */
export function validateChatFile(file, tenantId) {
  const ext = getExt(file.name);

  if (BLOCKED_EXTS.has(ext)) {
    return { valid: false, error: `File type "${ext}" is not allowed for security reasons.`, fileType: null };
  }

  const fileType = detectFileType(file.mimetype, ext);
  if (!fileType) {
    return {
      valid: false,
      error: "Unsupported file type. Allowed: images (jpg/png/webp/gif), video (mp4/webm), audio (mp3/wav), documents (pdf/doc/xls/txt).",
      fileType: null,
    };
  }

  const cfg = CHAT_ALLOWED[fileType];
  if (file.size > cfg.maxBytes) {
    const mb = (cfg.maxBytes / 1024 / 1024).toFixed(0);
    return { valid: false, error: `File too large. Maximum ${mb} MB for ${fileType}.`, fileType: null };
  }

  // Rate limit (TODO: Redis rate limit for multi-instance deployments)
  if (tenantId && !checkRateLimit(tenantId)) {
    return {
      valid: false,
      error: "Upload rate limit exceeded. Please wait a moment before sending more files.",
      fileType: null,
    };
  }

  return { valid: true, error: null, fileType };
}

/**
 * Upload a validated chat file to R2.
 * Returns { url, thumbnailUrl, fileType, mimeType, fileSize, originalName }.
 *
 * Call validateChatFile() before this. If the subsequent WhatsApp API call fails,
 * call rollbackChatAttachment(url, thumbnailUrl) to clean up orphaned R2 files.
 */
export async function uploadChatAttachment(file, tenantId, contactId) {
  const ext = getExt(file.name);
  const { sanitizedName } = sanitizeFilename(file.name);
  const fileBuffer = file.data;
  const mimeType = file.mimetype;
  const fileType = detectFileType(mimeType, ext);

  await runVirusScan(fileBuffer, file.name);

  let keyBase = `chat-attachments/${tenantId}/${contactId}/${sanitizedName}`;
  let uploadBuffer = fileBuffer;
  let uploadMime = mimeType;
  let thumbnailUrl = null;
  let finalOriginalName = file.name;

  // WhatsApp Cloud API supports audio/ogg (Opus) but NOT audio/webm.
  // Chrome MediaRecorder always produces WebM/Opus. Since both containers use the same Opus codec,
  // we store as audio/ogg so WhatsApp can deliver the voice message successfully.
  if (fileType === "audio" && (mimeType === "audio/webm" || mimeType.startsWith("audio/webm;"))) {
    uploadMime = "audio/ogg";
    keyBase = keyBase.replace(/\.webm$/, ".ogg");
    finalOriginalName = finalOriginalName.replace(/\.webm$/, ".ogg");
  }

  if (fileType === "image") {
    // Thumbnail: 400×400 JPEG for preview strip and message bubble
    const thumbBuffer = await sharp(fileBuffer)
      .resize(400, 400, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    const thumbKey = keyBase.replace(ext, "-thumb.jpg");
    thumbnailUrl = await r2Put(thumbKey, thumbBuffer, "image/jpeg");

    // Resize main image to max 1200px for web display
    uploadBuffer = await sharp(fileBuffer)
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    uploadMime = "image/jpeg";
  }

  // TODO: ffmpeg video thumbnail — extract first frame when ffmpeg binary is available on server.
  // Install fluent-ffmpeg + ffmpeg binary, call ffprobe to extract frame, upload as -thumb.jpg.

  const url = await r2Put(keyBase, uploadBuffer, uploadMime);

  return {
    url,
    thumbnailUrl,
    fileType,
    mimeType: uploadMime,
    fileSize: fileBuffer.length,
    originalName: finalOriginalName,
  };
}

/**
 * Download incoming WhatsApp media from Meta CDN and store permanently in R2.
 * This is the "download-on-receive" pattern used by all commercial WhatsApp chatbots
 * (Twilio, 360dialog, Wati) — Meta media IDs expire within ~5 minutes, so we must
 * download immediately during webhook processing rather than proxying on demand.
 *
 * Returns the permanent R2 public URL, or null on failure (caller logs and continues).
 */
export async function downloadAndStoreIncomingMedia(mediaId, mimeType, fileType, tenantId, contactId) {
  try {
    const accessToken = await getSecret(tenantId, "whatsapp");
    if (!accessToken) return null;

    // Step 1: Resolve the actual CDN download URL from the media ID
    const metaInfoRes = await axios.get(
      `https://graph.facebook.com/v23.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10_000,
      }
    );
    const cdnUrl = metaInfoRes.data?.url;
    if (!cdnUrl) return null;

    // Step 2: Download the raw bytes
    const mediaRes = await axios.get(cdnUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: "arraybuffer",
      timeout: 60_000,
      maxContentLength: 25 * 1024 * 1024,
    });
    const buffer = Buffer.from(mediaRes.data);

    // Step 3: Determine extension from MIME type
    // Normalize MIME first: strip codec params e.g. "audio/ogg; codecs=opus" → "audio/ogg"
    const normalizedMime = (mimeType || "").split(";")[0].trim().toLowerCase();
    const MIME_TO_EXT = {
      "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
      "video/mp4": "mp4", "video/webm": "webm",
      "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/opus": "opus", "audio/aac": "aac",
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    };
    const ext = MIME_TO_EXT[normalizedMime] || "bin";
    const key = `chat-attachments/${tenantId}/${contactId || "unknown"}/${crypto.randomUUID()}-incoming.${ext}`;

    // Step 4: Generate image thumbnail (same as outgoing uploads)
    let thumbnailUrl = null;
    if (fileType === "image" || mimeType?.startsWith("image/")) {
      try {
        const thumbBuffer = await sharp(buffer)
          .resize(400, 400, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 75 })
          .toBuffer();
        const thumbKey = key.replace(`.${ext}`, "-thumb.jpg");
        thumbnailUrl = await r2Put(thumbKey, thumbBuffer, "image/jpeg");
      } catch (_) {
        // Thumbnail failure is non-fatal
      }
    }

    // Step 5: Upload to R2
    const r2Url = await r2Put(key, buffer, mimeType || "application/octet-stream");
    return { r2Url, thumbnailUrl };
  } catch (err) {
    console.error("[MEDIA-DOWNLOAD] Failed to download/store incoming media:", err.message);
    return null;
  }
}

/**
 * Delete R2 objects for a chat attachment (main + thumbnail).
 * Call this when the WhatsApp API send fails after a successful R2 upload,
 * to prevent orphaned files from accumulating.
 *
 * TODO: Orphan cleanup cron — scan R2 for keys under chat-attachments/ older than 30 days
 * where the matching message row has is_deleted=true. Follow the pattern in hardDeleteCron.js.
 */
export async function rollbackChatAttachment(url, thumbnailUrl) {
  const baseUrl = process.env.R2_PUBLIC_URL;

  const deleteKey = async (fileUrl) => {
    if (!fileUrl) return;
    try {
      const key = fileUrl.replace(`${baseUrl}/`, "");
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }),
      );
    } catch (e) {
      console.error("[CHAT-ATTACH] Rollback delete failed:", e.message);
    }
  };

  await deleteKey(url);
  await deleteKey(thumbnailUrl);
}
