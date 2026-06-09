/**
 * Cloudflare R2 Storage Service
 * Handles preview uploads for Gallery UI display.
 * R2 is S3-compatible and uses AWS SDK v3.
 *
 * NOTE: preview_url is for Gallery UI only.
 *       media_handle (Meta) is what WhatsApp API uses.
 *       These are separate concerns and should not be mixed.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import path from "path";

const s3Client = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload file to Cloudflare R2 and return a public preview URL.
 * Called after Meta upload succeeds. If it fails, we return null (non-blocking).
 *
 * - image: resized to 800x800 JPEG before upload
 * - video: uploaded as-is for modal playback preview
 * - document: uploaded as-is for download/preview
 */
export async function uploadPreviewToStorage(
  fileBuffer,
  mimeType,
  fileType,
  fileName,
  tenantId,
  assetId,
) {
  try {
    // Guard: only image, video and document are supported
    if (fileType !== "image" && fileType !== "video" && fileType !== "document") {
      return null;
    }

    let uploadBuffer = fileBuffer;
    let uploadMimeType = mimeType;
    let fileExtension = path.extname(fileName).toLowerCase();

    // Images: resize to thumbnail before uploading.
    // Full-resolution copy already lives on Meta servers.
    if (fileType === "image") {
      uploadBuffer = await sharp(fileBuffer)
        .resize(800, 800, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toBuffer();
      uploadMimeType = "image/jpeg";
      fileExtension = ".jpg";
    }

    // Videos and documents are uploaded as-is (no transformation)

    // Build a unique, tenant-scoped file key
    const baseName = path.basename(fileName, path.extname(fileName));
    const sanitizedName = baseName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
    const fileKey = `${tenantId}/${assetId}-${sanitizedName}${fileExtension}`;

    await s3Client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileKey,
        Body: uploadBuffer,
        ContentType: uploadMimeType,
        CacheControl: "public, max-age=31536000",
      }),
    );

    return `${process.env.R2_PUBLIC_URL}/${fileKey}`;
  } catch (error) {
    // Non-blocking: media_handle upload to Meta already succeeded.
    console.error("R2 upload failed:", error.message);
    return null;
  }
}

/**
 * Delete a file from Cloudflare R2 by its public URL.
 *
 * IMPORTANT: Call this only for permanent purge.
 * For soft delete, do not call this. Set is_deleted=true and let lifecycle clean up.
 */
export async function deletePreviewFromStorage(previewUrl) {
  try {
    if (!previewUrl) return;

    const baseUrl = process.env.R2_PUBLIC_URL;
    const fileKey = previewUrl.replace(`${baseUrl}/`, "");

    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: fileKey,
      }),
    );

    console.log(`Deleted from R2: ${fileKey}`);
  } catch (error) {
    // Non-blocking
    console.error("R2 delete failed:", error.message);
  }
}
