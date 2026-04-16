import jwt from "jsonwebtoken";
import ServerEnvironmentConfig from "../../config/server.config.js";
import { getManagementByIdService } from "../../models/ManagementModel/management.service.js";
import { findTenantUserByIdService } from "../../models/TenantUserModel/tenantuser.service.js";
import { findTenantByIdService } from "../../models/TenantModel/tenant.service.js";

const buildDisplayName = (user = {}) => {
  const username = String(user?.username || user?.name || "").trim();
  const title = String(user?.title || "").trim();

  if (title && username) {
    const normalizedTitle = title.toLowerCase();
    const titleRegex = new RegExp(`\\b${normalizedTitle}\\b`, "i");
    if (!titleRegex.test(username)) {
      return `${title}. ${username}`;
    }
  }

  return username || "";
};

/* =========================
   TOKEN GENERATORS
========================= */

export const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      unique_id: user.unique_id || null,
      user_type: user.user_type, // management | tenant
      tenant_id: user.tenant_id || null, // null for management
      role: user.role,
    },
    ServerEnvironmentConfig.jwt_key,
    { expiresIn: "24h" },
  );
};

export const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      unique_id: user.unique_id || null,
      user_type: user.user_type,
      tenant_id: user.tenant_id || null,
      role: user.role,
    },
    ServerEnvironmentConfig.jwt_key,
    { expiresIn: "7d" },
  );
};

/* =========================
   GENERATE INVITE TOKEN
========================= */

export const generateInviteToken = (payload) => {
  return jwt.sign(payload, ServerEnvironmentConfig.jwt_key, {
    expiresIn: "48h",
  });
};

export const generateRememberMeToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      unique_id: user.unique_id || null,
      user_type: user.user_type,
      tenant_id: user.tenant_id || null,
      role: user.role,
    },
    ServerEnvironmentConfig.jwt_key,
    { expiresIn: "30d" },
  );
};

/* =========================
   AUTHENTICATE
========================= */

export const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, ServerEnvironmentConfig.jwt_key);
    req.user = decoded;

    console.log("authdecode", decoded);

    // 🔵 MANAGEMENT USER CHECK
    if (decoded.user_type === "management") {
      const user = await getManagementByIdService(decoded.unique_id);
      console.log("ddd", user);
      if (!user) {
        return res.status(401).json({
          message: "Account no longer exists. Please login again.",
        });
      }
      if (user.status && user.status !== "active") {
        return res.status(403).json({
          message: "Your account has been deactivated. Contact administrator.",
        });
      }

      req.user.management_id = user.management_id;
      req.user.username = user.username;
      req.user.email = user.email || null;
      req.user.name = buildDisplayName(user) || user.email || null;
    }

    // 🟢 TENANT USER CHECK
    if (decoded.user_type === "tenant") {
      const user = await findTenantUserByIdService(decoded.unique_id);

      if (!user) {
        return res.status(401).json({
          message: "Account no longer exists. Please login again.",
        });
      }

      // Check individual tenant user status
      if (user.status && user.status !== "active") {
        return res.status(403).json({
          message: "Your account has been deactivated. Contact your admin.",
        });
      }

      // Add useful user info to req.user
      req.user.tenant_user_id = user.tenant_user_id;
      req.user.username = user.username;
      req.user.email = user.email || null;
      req.user.name = buildDisplayName(user) || user.email || null;

      // 🔴 GLOBAL TENANT STATUS CHECK
      const tenant = await findTenantByIdService(decoded.tenant_id);
      console.log("tenant", tenant);
      if (!tenant || tenant.status !== "active") {
        return res.status(403).json({
          message: "Tenant account is inactive. Access denied.",
        });
      }
    }

    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

/* =========================
   AUTHORIZE (DYNAMIC)
========================= */

export const authorize = ({ user_type, roles = [] }) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user || user.user_type !== user_type) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ message: "Permission denied" });
    }

    next();
  };
};

/* =========================
   AUTHENTICATE ADMIN (combined single middleware for management routes)
========================= */

export const authenticateAdmin = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, ServerEnvironmentConfig.jwt_key);

    if (decoded.user_type !== "management") {
      return res.status(403).json({ message: "Access denied" });
    }

    if (decoded.role !== "super_admin" && decoded.role !== "platform_admin") {
      return res.status(403).json({ message: "Permission denied" });
    }

    const user = await getManagementByIdService(decoded.unique_id);
    if (!user) {
      return res
        .status(401)
        .json({ message: "Account no longer exists. Please login again." });
    }
    if (user.status && user.status !== "active") {
      return res
        .status(403)
        .json({
          message: "Your account has been deactivated. Contact administrator.",
        });
    }

    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

/* =========================
   CHECK TOKEN
========================= */

export const checkToken = (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  try {
    jwt.verify(token, ServerEnvironmentConfig.jwt_key);
    res.status(200).json({ valid: true });
  } catch (err) {
    res.status(401).json({
      message:
        err.name === "TokenExpiredError" ? "Token expired" : "Invalid token",
    });
  }
};

/* =========================
   REFRESH TOKEN
========================= */

export const refreshToken = (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ message: "Refresh token required" });
  }

  jwt.verify(refreshToken, ServerEnvironmentConfig.jwt_key, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Invalid refresh token" });
    }

    return res.status(200).json({
      accessToken: generateAccessToken(user),
      refreshToken: generateRefreshToken(user),
    });
  });
};
