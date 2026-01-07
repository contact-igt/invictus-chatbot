import cloudinary from "./cloudinaryMiddleware.js";

export const uploadToCloudinary = (
  file,
  type = "image",
  mode = "public",
  folder = "pets"
) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.v2.uploader.upload_stream(
      {
        resource_type: type,
        folder: folder,
        access_mode: mode,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );

    stream.end(file.data);
  });
};
