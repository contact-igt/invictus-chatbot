import axios from "axios";
import { getWhatsappAccountByTenantService } from "../../models/WhatsappAccountModel/whatsappAccount.service.js";

/**
 * Uploads a media file from a URL to Meta's Resumable Upload API
 * and returns the header_handle (h) required for template creation.
 * 
 * @param {string} tenant_id - The tenant ID
 * @param {string} mediaUrl - The Cloudinary or public URL of the media
 * @param {string} format - The media format (IMAGE, VIDEO, DOCUMENT)
 * @returns {Promise<string>} - The header_handle ('h' value)
 */
export const uploadMediaToMetaForTemplate = async (tenant_id, mediaUrl, format) => {
  try {
    const whatsappAccount = await getWhatsappAccountByTenantService(tenant_id);
    if (!whatsappAccount || whatsappAccount.status !== "active") {
      throw new Error("No active WhatsApp account found to perform media upload.");
    }
    const accessToken = whatsappAccount.access_token;
    const API_VERSION = process.env.META_API_VERSION || "v22.0";

    // 1. Fetch the file from the URL to get its buffer and length
    const response = await axios.get(mediaUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    const fileLength = buffer.length;
    let fileType = response.headers["content-type"];

    if (!fileType || fileType === "application/octet-stream") {
       if (format === "IMAGE") fileType = "image/jpeg";
       else if (format === "VIDEO") fileType = "video/mp4";
       else fileType = "application/pdf";
    }

    // 2. Fetch the App ID using the access token
    const appRes = await axios.get(`https://graph.facebook.com/${API_VERSION}/app`, {
      params: { access_token: accessToken }
    });
    const appId = appRes.data.id;

    if (!appId) {
        throw new Error("Could not retrieve App ID from Meta.");
    }

    // 3. Create Upload Session
    const sessionRes = await axios.post(
      `https://graph.facebook.com/${API_VERSION}/${appId}/uploads`,
      null,
      {
        params: {
          file_length: fileLength,
          file_type: fileType,
          access_token: accessToken,
        },
      }
    );
    const sessionId = sessionRes.data.id;

    if (!sessionId) {
        throw new Error("Failed to create Meta upload session.");
    }

    // 4. Upload the file binary to the session
    const uploadRes = await axios.post(
      `https://graph.facebook.com/${API_VERSION}/${sessionId}`,
      buffer,
      {
        headers: {
          Authorization: `OAuth ${accessToken}`,
          "Content-Type": "application/octet-stream", // Optional, wait, authorization is needed here
          file_offset: 0,
        },
      }
    );

    const headerHandle = uploadRes.data.h;
    if (!headerHandle) {
        throw new Error("Failed to retrieve header_handle (h) from Meta upload.");
    }

    return headerHandle;
  } catch (error) {
    if (error.response) {
      console.error("[META MEDIA UPLOAD ERROR]", error.response.data);
      throw new Error(`Meta Media Upload Failed: ${error.response.data?.error?.message || error.message}`);
    }
    throw error;
  }
};
