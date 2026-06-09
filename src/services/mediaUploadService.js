/**
 * Media Upload Service
 * Handles file uploads to Meta's Resumable Upload API
 * Returns permanent media handles for use in WhatsApp templates and campaigns
 */

import axios from "axios";
import FormData from "form-data";

const META_GRAPH_API_VERSION = "v23.0";
const META_GRAPH_API_BASE = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;

/**
 * Create an upload session with Meta's Resumable Upload API
 * @param {number} fileSize - File size in bytes
 * @param {string} mimeType - MIME type of the file (e.g., 'image/jpeg')
 * @param {string} accessToken - WhatsApp Business API access token
 * @param {string} appId - Meta App ID
 * @returns {Promise<string>} Upload session ID
 */
export const createUploadSession = async (
  fileSize,
  mimeType,
  accessToken,
  appId,
) => {
  try {
    const response = await axios.post(
      `${META_GRAPH_API_BASE}/${appId}/uploads`,
      null,
      {
        params: {
          file_length: fileSize,
          file_type: mimeType,
          access_token: accessToken,
        },
      },
    );

    if (!response.data || !response.data.id) {
      throw new Error("Failed to create upload session: No session ID returned");
    }

    return response.data.id;
  } catch (error) {
    console.error("Error creating upload session:", error.response?.data || error.message);
    throw new Error(
      `Failed to create upload session: ${error.response?.data?.error?.message || error.message}`,
    );
  }
};

/**
 * Upload file bytes to Meta's Resumable Upload API
 * @param {string} sessionId - Upload session ID from createUploadSession
 * @param {Buffer} fileBuffer - File content as Buffer
 * @param {string} accessToken - WhatsApp Business API access token
 * @returns {Promise<string>} Permanent media handle (e.g., "4::AbCDEFGH...")
 */
export const uploadFileBytes = async (sessionId, fileBuffer, accessToken) => {
  try {
    const response = await axios.post(
      `${META_GRAPH_API_BASE}/${sessionId}`,
      fileBuffer,
      {
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: "0",
          "Content-Type": "application/octet-stream",
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      },
    );

    if (!response.data || !response.data.h) {
      throw new Error("Failed to upload file: No media handle returned");
    }

    return response.data.h;
  } catch (error) {
    console.error("Error uploading file bytes:", error.response?.data || error.message);
    throw new Error(
      `Failed to upload file: ${error.response?.data?.error?.message || error.message}`,
    );
  }
};

/**
 * Complete upload flow: create session and upload file
 * @param {Buffer} fileBuffer - File content as Buffer
 * @param {string} mimeType - MIME type of the file
 * @param {string} accessToken - WhatsApp Business API access token
 * @param {string} appId - Meta App ID
 * @returns {Promise<string>} Permanent media handle
 */
export const uploadMediaToMeta = async (
  fileBuffer,
  mimeType,
  accessToken,
  appId,
) => {
  const fileSize = fileBuffer.length;

  // Step 1: Create upload session
  const sessionId = await createUploadSession(
    fileSize,
    mimeType,
    accessToken,
    appId,
  );

  // Step 2: Upload file bytes
  const mediaHandle = await uploadFileBytes(sessionId, fileBuffer, accessToken);

  return mediaHandle;
};
