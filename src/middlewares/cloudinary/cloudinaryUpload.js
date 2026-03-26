import cloudinary from "./cloudinaryMiddleware.js";
import path from "path";

export const uploadToCloudinary = (
  file,
  type = "image",
  mode = "public",
  folder = "pets"
) => {
  return new Promise((resolve, reject) => {
    const options = {
      resource_type: type,
      folder: folder,
      access_mode: mode,
    };

    // For raw uploads (documents/PDFs), use a readable public_id without extension
    // Extension in public_id causes 401 on Cloudinary raw resources
    if (type === "raw" && file.name) {
      const ext = path.extname(file.name);
      const baseName = path.basename(file.name, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
      const uniqueSuffix = Date.now();
      options.public_id = `${baseName}_${uniqueSuffix}`;
    }

    const stream = cloudinary.v2.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );

    stream.end(file.data);
  });
};
