import axios from "axios";
import { getWhatsappAccountByTenantService } from "../../models/WhatsappAccountModel/whatsappAccount.service.js";
import FormData from "form-data";

/**
 * Uploads a media file from a URL to Meta's Resumable Upload API.
 * This is the ONLY supported method for uploading media headers for WhatsApp Templates in recent API versions.
 * 
 * Flow:
 * 1. Fetch Cloudinary media buffer and sanitize MIME type.
 * 2. Fetch the target App ID dynamically using debug_token.
 * 3. Create an upload session -> /{app-id}/uploads
 * 4. Stream the buffer to the session -> /{session-id}
 * 5. Return the `h` value (the handle string) to be used in the template payload.
 */
export const uploadMediaToMetaForTemplate = async (tenant_id, mediaUrl, format) => {
  try {
    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      throw new Error("No active WhatsApp account found to perform media upload.");
    }
    const accessToken = whatsappAccount.access_token;

    // 1. Fetch file from URL to get buffer and content-type
    const response = await axios.get(mediaUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    
    let originalContentType = response.headers["content-type"] || "";
    originalContentType = originalContentType.split(";")[0].trim();
    let fileType = originalContentType;

    // Meta's strict file_type requirement for templates
    if (!fileType || fileType.includes("application/octet-stream") || fileType.includes("binary") || fileType === "video" || fileType === "image") {
       if (format === "IMAGE") { fileType = "image/jpeg"; }
       else if (format === "VIDEO") { fileType = "video/mp4"; }
       else { fileType = "application/pdf"; }
    }
    
    // Safety overrides
    if (format === "VIDEO" && !fileType.startsWith("video/")) { fileType = "video/mp4"; }
    if (format === "IMAGE" && !fileType.startsWith("image/")) { fileType = "image/jpeg"; }

    const fileLength = buffer.length;

    // 2. Dynamically fetch the App ID using the debug_token endpoint
    // Meta requires the App ID for the Resumable Upload API.
    const tokenRes = await axios.get(`https://graph.facebook.com/v19.0/debug_token`, {
        params: {
            input_token: accessToken,
            access_token: accessToken
        }
    });
    const appId = tokenRes.data?.data?.app_id;
    if (!appId) {
        throw new Error("Failed to extract App ID from access token. Cannot proceed with Resumable Upload.");
    }

    // 3. Create Resumable Upload Session
    const sessionRes = await axios.post(
      `https://graph.facebook.com/v19.0/${appId}/uploads`,
      null, 
      {
        params: {
            file_length: fileLength,
            file_type: fileType
        },
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
      }
    );
    
    const uploadSessionId = sessionRes.data?.id;
    if (!uploadSessionId) {
        throw new Error("Failed to create Meta upload session.");
    }

    // 4. Upload File Data to Session
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v19.0/${uploadSessionId}`,
      buffer,
      {
        headers: {
            Authorization: `OAuth ${accessToken}`,
            "Content-Type": "application/octet-stream", // Meta requires octet-stream for the raw upload stream
            file_offset: 0
        }
      }
    );

    const handle = uploadRes.data?.h;
    if (!handle) {
        throw new Error("Failed to retrieve media handle from Resumable Upload.");
    }

    return handle;
  } catch (error) {
    if (error.response) {
      console.error("[META RESUMABLE UPLOAD ERROR]", error.response.data);
      throw new Error(`Meta Resumable Upload Failed: ${error.response.data?.error?.message || error.message}`);
    }
    throw error;
  }
};
