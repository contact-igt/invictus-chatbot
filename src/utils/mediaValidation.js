/**
 * Media Validation Utilities
 * Validates media files against WhatsApp Business API specifications
 */

// WhatsApp file size limits (in bytes)
const FILE_SIZE_LIMITS = {
  image: 5 * 1024 * 1024, // 5MB
  video: 16 * 1024 * 1024, // 16MB
  document: 100 * 1024 * 1024, // 100MB
  audio: 16 * 1024 * 1024, // 16MB
};

// WhatsApp allowed MIME types
const ALLOWED_MIME_TYPES = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/3gpp"],
  document: [
    "application/pdf",
    "application/vnd.ms-powerpoint",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  audio: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"],
};

// WhatsApp image dimension requirements (aspect ratios)
const IMAGE_ASPECT_RATIOS = {
  square: { min: 0.95, max: 1.05 }, // 1:1 (with 5% tolerance)
  horizontal: { min: 1.85, max: 1.95 }, // 1.91:1 (with tolerance)
};

/**
 * Validate file type against WhatsApp allowed types
 * @param {string} fileType - File type (image, video, document, audio)
 * @param {string} mimeType - MIME type of the file
 * @returns {{valid: boolean, error: string|null}}
 */
export const validateFileType = (fileType, mimeType) => {
  const validTypes = ["image", "video", "document", "audio"];

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
      error: `Invalid MIME type for ${fileType}. Allowed types: ${allowedMimeTypes.join(", ")}`,
    };
  }

  return { valid: true, error: null };
};

/**
 * Validate file size against WhatsApp limits
 * @param {number} fileSize - File size in bytes
 * @param {string} fileType - File type (image, video, document, audio)
 * @returns {{valid: boolean, error: string|null}}
 */
export const validateFileSize = (fileSize, fileType) => {
  const maxSize = FILE_SIZE_LIMITS[fileType];

  if (!maxSize) {
    return {
      valid: false,
      error: `Unknown file type: ${fileType}`,
    };
  }

  if (fileSize > maxSize) {
    const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(2);
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `File size (${fileSizeMB}MB) exceeds maximum allowed size of ${maxSizeMB}MB for ${fileType}`,
    };
  }

  return { valid: true, error: null };
};

/**
 * Validate image dimensions against WhatsApp requirements
 * Note: This is a basic validation. For production, consider using sharp or similar library
 * @param {number} width - Image width in pixels
 * @param {number} height - Image height in pixels
 * @returns {{valid: boolean, error: string|null}}
 */
export const validateImageDimensions = (width, height) => {
  if (!width || !height) {
    return {
      valid: false,
      error: "Invalid image dimensions",
    };
  }

  const aspectRatio = width / height;

  // Check if aspect ratio matches 1:1 (square)
  const isSquare =
    aspectRatio >= IMAGE_ASPECT_RATIOS.square.min &&
    aspectRatio <= IMAGE_ASPECT_RATIOS.square.max;

  // Check if aspect ratio matches 1.91:1 (horizontal)
  const isHorizontal =
    aspectRatio >= IMAGE_ASPECT_RATIOS.horizontal.min &&
    aspectRatio <= IMAGE_ASPECT_RATIOS.horizontal.max;

  if (!isSquare && !isHorizontal) {
    return {
      valid: false,
      error: `Image aspect ratio (${aspectRatio.toFixed(2)}:1) must be either 1:1 (square) or 1.91:1 (horizontal). Current dimensions: ${width}x${height}`,
    };
  }

  return { valid: true, error: null };
};

/**
 * Comprehensive media file validation
 * @param {Object} file - File object with properties: name, size, mimetype, buffer
 * @param {string} fileType - File type (image, video, document, audio)
 * @returns {{valid: boolean, error: string|null}}
 */
export const validateMediaFile = (file, fileType) => {
  // Validate file type and MIME type
  const typeValidation = validateFileType(fileType, file.mimetype);
  if (!typeValidation.valid) {
    return typeValidation;
  }

  // Validate file size
  const sizeValidation = validateFileSize(file.size, fileType);
  if (!sizeValidation.valid) {
    return sizeValidation;
  }

  // For images, we would validate dimensions here if we had image metadata
  // This would require using a library like sharp to read image dimensions
  // For now, we'll skip dimension validation and add it as an enhancement

  return { valid: true, error: null };
};

/**
 * Get file type from MIME type
 * @param {string} mimeType - MIME type of the file
 * @returns {string|null} File type (image, video, document, audio) or null if unknown
 */
export const getFileTypeFromMimeType = (mimeType) => {
  for (const [fileType, mimeTypes] of Object.entries(ALLOWED_MIME_TYPES)) {
    if (mimeTypes.includes(mimeType)) {
      return fileType;
    }
  }
  return null;
};
