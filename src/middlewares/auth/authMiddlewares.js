import jwt from "jsonwebtoken";
import ServerEnvironmentConfig from "../../config/server.config.js";

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role ? user.role : "user",
    },
    ServerEnvironmentConfig?.jwt_key,
    { expiresIn: "15m" }
  );
};

const generateRememberMeoken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role ? user.role : "user",
    },
    ServerEnvironmentConfig?.jwt_key,
    {
      expiresIn: "30d",
    }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role ? user.role : "user",
    },
    ServerEnvironmentConfig?.jwt_key,
    {
      expiresIn: "7d",
    }
  );
};

const decodeAuthToken = (token) => {
  const currenttoken = token && token.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const decoded = jwt.verify(currenttoken, ServerEnvironmentConfig?.jwt_key);
  return decoded;
};

// user token auth
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  jwt.verify(token, ServerEnvironmentConfig.jwt_key, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Unauthorized" });
    }
    req.user = user;
    next();
  });
};

// super admin token auth
const authenticateSuperAdminToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, ServerEnvironmentConfig.jwt_key);

    if (decoded.role !== "super-admin") {
      return res.status(403).json({
        message: "You don't have permission to manage",
      });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Unauthorized" });
  }
};

// management token auth
const authenticateManagementToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, ServerEnvironmentConfig.jwt_key);

    if (decoded.role !== "super-admin" && decoded.role !== "admin") {
      return res.status(403).json({
        message: "You don't have permission to manage",
      });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Unauthorized" });
  }
};

export const checkToken = (req, res, next) => {
  const token = req.header("Authorization")?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }
  try {
    jwt.verify(token, ServerEnvironmentConfig.jwt_key);
    return res.status(200).json({ message: "Valid token" });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(200).json({ message: "Token expired" });
    }
    return res.status(200).json({ message: "Invalid token" });
  }
};

export const refreshToken = (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken)
    return res.status(401).json({ message: "Refresh token required" });

  jwt.verify(refreshToken, ServerEnvironmentConfig?.jwt_key, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid refresh token" });

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    return res
      .status(200)
      .json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  });
};

export {
  generateAccessToken,
  generateRefreshToken,
  generateRememberMeoken,
  authenticateToken,
  decodeAuthToken,
  authenticateManagementToken,
  authenticateSuperAdminToken,
};
