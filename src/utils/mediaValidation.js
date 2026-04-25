/**
 * Media Validation Utilities
 * Supports template-safe uploads only:
 * images (JPEG/PNG), videos (MP4), documents (PDF).
 * Audio and other formats are not supported.
 */

// Allowed MIME types per file type
export const ALLOWED_MIME_TYPES = {
  image: ["image/jpeg", "image/png"],
  video: ["video/mp4"],
  document: ["application/pdf"],
};

export const ALLOWED_TEMPLATE_HEADER_EXTENSIONS = {
  image: ["jpg", "jpeg", "png"],
  video: ["mp4"],
  document: ["pdf"],
};

export const ALLOWED_TEMPLATE_HEADER_MIME_TYPES = {
  image: ["image/jpeg", "image/png"],
  video: ["video/mp4"],
  document: ["application/pdf"],
};

const getNormalizedFileExtension = (fileName = "") => {
  const cleanName = String(fileName || "")
    .trim()
    .split("?")[0]
    .split("#")[0];

  const parts = cleanName.split(".");
  if (parts.length < 2) {
    return null;
  }

  return parts.pop().toLowerCase();
};

/**
 * Get file type from MIME type.
 * Returns null for unsupported types (including audio).
 * @param {string} mimeType
 * @returns {"image"|"video"|"document"|null}
 */
export const getFileTypeFromMimeType = (mimeType) => {
  for (const [fileType, mimeTypes] of Object.entries(ALLOWED_MIME_TYPES)) {
    if (mimeTypes.includes(mimeType)) {
      return fileType;
    }
  }
  return null;
};

/**
 * Comprehensive media file validation.
 * Checks MIME type and enforces min/max size limits.
 *
 * IMAGE  (JPEG/PNG): 5KB – 2MB
 * VIDEO  (MP4):      10KB – 10MB
 * DOCUMENT (PDF):    1KB – 10MB
 *
 * @param {{ name: string, size: number, mimetype: string, buffer: Buffer }} file
 * @param {"image"|"video"|"document"} fileType
 * @returns {{ valid: boolean, error: string|null }}
 */
export const validateMediaFile = (file, fileType) => {
  const { name, size, mimetype } = file;
  const kb = size / 1024;
  const mb = size / 1024 / 1024;
  const fileExtension = getNormalizedFileExtension(name);
  const allowedExtensions = ALLOWED_TEMPLATE_HEADER_EXTENSIONS[fileType] || [];

  if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
    return {
      valid: false,
      error: `Unsupported ${fileType} format. Allowed formats: ${allowedExtensions.join(", ")}.`,
    };
  }

  if (fileType === "image") {
    if (!ALLOWED_MIME_TYPES.image.includes(mimetype)) {
      return { valid: false, error: "Image must be JPEG or PNG" };
    }
    if (kb < 5) return { valid: false, error: "Image too small. Minimum 5KB" };
    if (mb > 2) return { valid: false, error: "Image too large. Maximum 2MB" };
    return { valid: true, error: null };
  }

  if (fileType === "video") {
    if (!ALLOWED_MIME_TYPES.video.includes(mimetype)) {
      return { valid: false, error: "Video must be MP4" };
    }
    if (kb < 10)
      return { valid: false, error: "Video too small. Minimum 10KB" };
    if (mb > 10)
      return { valid: false, error: "Video too large. Maximum 10MB" };
    return { valid: true, error: null };
  }

  if (fileType === "document") {
    if (!ALLOWED_MIME_TYPES.document.includes(mimetype)) {
      return { valid: false, error: "Document must be PDF" };
    }
    if (kb < 1)
      return { valid: false, error: "Document too small. Minimum 1KB" };
    if (mb > 10)
      return { valid: false, error: "Document too large. Maximum 10MB" };
    return { valid: true, error: null };
  }

  return {
    valid: false,
    error: "Only images, videos and documents are supported",
  };
};

/**
 * Validate file type and MIME type.
 * Kept for backward compatibility with any existing callers.
 */
export const validateFileType = (fileType, mimeType) => {
  const validTypes = ["image", "video", "document"];
  if (!validTypes.includes(fileType)) {
    return {
      valid: false,
      error: `Invalid file type. Must be one of: ${validTypes.join(", ")}`,
    };
  }
  const allowedMimeTypes = ALLOWED_MIME_TYPES[fileType];
  if (!allowedMimeTypes.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid MIME type for ${fileType}. Allowed: ${allowedMimeTypes.join(", ")}`,
    };
  }
  return { valid: true, error: null };
};

export const validateTemplateHeaderMedia = ({
  expectedType,
  fileType,
  mimeType,
  fileName,
}) => {
  const normalizedExpectedType = String(expectedType || "")
    .trim()
    .toLowerCase();
  const normalizedFileType = String(fileType || "")
    .trim()
    .toLowerCase();
  const normalizedMimeType = String(mimeType || "")
    .trim()
    .toLowerCase();
  const allowedMimeTypes =
    ALLOWED_TEMPLATE_HEADER_MIME_TYPES[normalizedExpectedType] || [];
  const allowedExtensions =
    ALLOWED_TEMPLATE_HEADER_EXTENSIONS[normalizedExpectedType] || [];
  const fileExtension = getNormalizedFileExtension(fileName);

  if (!["image", "video", "document"].includes(normalizedExpectedType)) {
    return {
      valid: false,
      error: `Unsupported template header type: ${expectedType}`,
    };
  }

  if (normalizedFileType && normalizedFileType !== normalizedExpectedType) {
    return {
      valid: false,
      error: `Selected ${normalizedFileType} file does not match the ${normalizedExpectedType} header type.`,
    };
  }

  if (normalizedMimeType && !allowedMimeTypes.includes(normalizedMimeType)) {
    return {
      valid: false,
      error: `Unsupported ${normalizedExpectedType} format. Allowed formats: ${allowedExtensions.join(", ")}.`,
    };
  }

  if (fileExtension && !allowedExtensions.includes(fileExtension)) {
    return {
      valid: false,
      error: `Unsupported ${normalizedExpectedType} file extension ".${fileExtension}". Allowed formats: ${allowedExtensions.join(", ")}.`,
    };
  }

  if (!normalizedMimeType && !fileExtension) {
    return {
      valid: false,
      error: `Unable to verify the ${normalizedExpectedType} file format. Allowed formats: ${allowedExtensions.join(", ")}.`,
    };
  }

  return { valid: true, error: null };
};

/**
 * Validate file size against per-type max limits.
 * Kept for backward compatibility with any existing callers.
 */
export const validateFileSize = (fileSize, fileType) => {
  const maxMB = { image: 2, video: 10, document: 10 }[fileType];
  if (!maxMB) return { valid: false, error: `Unknown file type: ${fileType}` };
  if (fileSize / 1024 / 1024 > maxMB) {
    return {
      valid: false,
      error: `File too large. Maximum ${maxMB}MB for ${fileType}`,
    };
  }
  return { valid: true, error: null };
};

/**
 * Validate image dimensions.
 * Kept for future use — currently not enforced.
 */
export const validateImageDimensions = (width, height) => {
  if (!width || !height)
    return { valid: false, error: "Invalid image dimensions" };
  return { valid: true, error: null };
};
