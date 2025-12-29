import cloudinary from "cloudinary";
import CloudinaryConfig from "../../config/cloudinary.config.js";

cloudinary.config({
  cloud_name: CloudinaryConfig.cloud_name,
  api_key: CloudinaryConfig.api_key,
  api_secret: CloudinaryConfig.api_secret,
});

export default cloudinary;
