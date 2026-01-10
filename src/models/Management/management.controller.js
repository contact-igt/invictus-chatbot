import {
  decodeAuthToken,
  generateAccessToken,
  generateRefreshToken,
} from "../../middlewares/auth/authMiddlewares.js";
import { missingFieldsChecker } from "../../utils/missingFields.js";
// import {
//   findUserByIdService,
//   updateOldUserPasswordByIdService,
//   updateUserPasswordByIdService,
// } from "../UserModels/user.service.js";
import {
  getManagementService,
  getManagementByIdService,
  loginManagementService,
  registerManagementService,
  // updateManagementByIdService,
  // deleteManagementByIdService,
} from "./management.service.js";
// import { uploadToCloudinary } from "../../middlewares/cloudinary/cloudinaryUpload.js";
// import fs from "fs";
// import path from "path";
import bcrypt from "bcrypt";
// import handlebars from "handlebars";
// import { fileURLToPath } from "url";
// import ServerEnvironmentConfig from "../../config/server.config.js";
// import { generateWordPressHashedPassword } from "../../utils/generateWordPressHashPassword.js";
// import { tableNames } from "../../database/tableName.js";

export const registerManagementController = async (req, res) => {
  // const token = req.header("Authorization");

  const {
    tenant_id,
    title,
    username,
    email,
    country_code,
    mobile,
    password,
    role,
  } = req.body;

  const requiredFields = {
    tenant_id,
    username,
    email,
    country_code,
    mobile,
    role,
  };

  const missingFields = await missingFieldsChecker(requiredFields);

  if (missingFields.length > 0) {
    return res.status(400).json({
      message: `Missing required field(s) ${missingFields.join(", ")} `,
    });
  }

  try {
    // const decoded = decodeAuthToken(token);

    // if (decoded.role !== "super-admin") {
    //   return res.status(400).json({
    //     message: "You don't have access to create new management user",
    //   });
    // }

    await registerManagementService(
      tenant_id,
      title,
      username,
      email,
      country_code,
      mobile,
      password,
      role
    );

    return res.status(200).json({
      message: "Successfully registered",
    });
  } catch (err) {
    if (err.original?.code === "ER_DUP_ENTRY") {
      return res
        .status(400)
        .json({ message: "Email or mobile number already in use" });
    }

    return res.status(500).json({
      message: err.message,
    });
  }
};

export const loginManagementController = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({
        message: "email and password required",
      });
    }

    const user = await loginManagementService(email);

    if (!user) {
      return res.status(401).json({ message: "Incorrect Email" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Incorrect Password" });
    }
    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user?.id,
        username: user?.name,
        email: user?.email,
        profile: user?.profile_picture,
        role: user?.role,
      },
      accessToken: accessToken,
      refreshToken: refreshToken,
    });
  } catch (err) {
    return res.status(500).json({
      message: err?.message,
    });
  }
};

export const getManagementController = async (req, res) => {
  try {
    const response = await getManagementService();

    return res.status(200).json({
      message: "success",
      data: response,
    });
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
};

export const getManagementByIdController = async (req, res) => {
  const user_id = req.params.id;

  try {
    const response = await getManagementByIdService(user_id);

    return res.status(200).json({
      message: "success",
      data: response,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

// export const updateManagementByIdController = async (req, res) => {
//   const user_id = req?.params?.id;

//   const {
//     title,
//     username,
//     email,
//     country_code,
//     mobile,
//     profile_picture,
//     role,
//   } = req.body;

//   const requiredFields = {
//     username,
//     email,
//     role,
//   };

//   const missingFields = await missingFieldsChecker(requiredFields);

//   if (missingFields.length > 0) {
//     return res.status(400).json({
//       message: `Missing required field(s) ${missingFields.join(", ")}`,
//     });
//   }

//   try {
//     let profile_picture_url;

//     if (req.files && req.files.profile_picture) {
//       const uploadPromises = uploadToCloudinary(
//         req.files.profile_picture,
//         "image",
//         "public",
//         `${tableNames.MANAGEMENT}/${username}`
//       );
//       profile_picture_url = await uploadPromises;
//     }

//     await updateManagementByIdService(
//       user_id,
//       title,
//       username,
//       email,
//       country_code,
//       mobile,
//       profile_picture_url ?? profile_picture,
//       role
//     );

//     return res.status(200).json({
//       message: "Data updated successfully",
//     });
//   } catch (err) {
//     if (err.original?.code === "ER_DUP_ENTRY") {
//       return res.status(400).json({ message: "This email is already used" });
//     }

//     return res.status(500).json({
//       message: err.message,
//     });
//   }
// };

// export const deleteManagementByIdController = async (req, res) => {
//   const user_id = req.params.id;

//   try {
//     await deleteManagementByIdService(user_id);

//     return res.status(200).json({
//       message: `id ${user_id} deleted succesfully`,
//     });
//   } catch (err) {
//     return res.status(500).json({
//       message: err.message,
//     });
//   }
// };

// export const userPasswordChange = async (req, res) => {
//   const { managementId, password, userId } = req.body;

//   if (!managementId || !password || !userId) {
//     return res.status(400).json({
//       message: "ManagementId and password and userId required",
//     });
//   }

//   const userData = await findUserByIdService(userId);
//   const managementData = await getManagementByIdService(managementId);

//   if (!userData || !managementData) {
//     return res.status(400).json({
//       message: "Invalid user or management",
//     });
//   }
//   console.log(userData, "userData");

//   const isOldUserBool =
//     userData?.isOldUser === true || userData?.isOldUser === "true";

//   try {
//     if (
//       managementData?.role == "super-admin" ||
//       managementData?.role == "admin"
//     ) {
//       if (isOldUserBool) {
//         const wordPressPasswordHased =
//           generateWordPressHashedPassword(password);

//         await updateOldUserPasswordByIdService(userId, wordPressPasswordHased);
//       } else {
//         const passwordhashed = await bcrypt.hash(password, 10);
//         await updateUserPasswordByIdService(userId, passwordhashed);
//       }

//       const __filename = fileURLToPath(import.meta.url);
//       const __dirname = path.dirname(__filename);

//       const templatePath = path.join(
//         __dirname,
//         "../../../public/html/userPasswordChanged/index.html"
//       );
//       const source = fs.readFileSync(templatePath, "utf8");

//       const template = handlebars.compile(source);
//       const emailHtml = template({
//         username: `${userData?.title} ${userData?.name}`,
//         admin_name: `${managementData.username}`,
//       });

//       const mailOptions = {
//         from: ServerEnvironmentConfig.auth.user,
//         to: userData?.email,
//         subject: `${userData?.name}, Your Password Has Been Changed`,
//         html: emailHtml,
//       };

//       req.transporter.sendMail(mailOptions, (error, info) => {
//         if (error) {
//           console.error("Error sending credentials:", error);
//           return res.status(500).json({
//             message: "Failed to send mail. Please try again later.",
//           });
//         }

//         return res.status(200).json({
//           message: `Password changed successfully by ${managementData?.username}. An email has been sent to the user.`,
//         });
//       });
//     } else {
//       return res.status(400).json({
//         message: "Invalid Access",
//       });
//     }
//   } catch (err) {
//     return res.status(500).json({
//       message: err.message,
//     });
//   }
// };
