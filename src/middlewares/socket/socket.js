import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import ServerEnvironmentConfig from "../../config/server.config.js";
import { getManagementByIdService } from "../../models/ManagementModel/management.service.js";
import { findTenantUserByIdService } from "../../models/TenantUserModel/tenantuser.service.js";

let io;
const MANAGEMENT_SOCKET_ROLES = new Set(["super_admin", "platform_admin"]);
const MANAGEMENT_ROOM = "management-room";
const MANAGEMENT_API_LOGS_ROOM = "management:api-request-logs";
const MANAGEMENT_ROOM_JOINED_EVENT = "management-room:joined";
const MANAGEMENT_ROOM_JOIN_DENIED_EVENT = "management-room:join-denied";
const MANAGEMENT_API_LOGS_JOINED_EVENT = "management-api-logs:joined";
const TENANT_ROOM_JOIN_DENIED_EVENT = "tenant-room:join-denied";
const ACCESS_DENIED_PAYLOAD = {
  success: false,
  message: "Access denied",
};

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

const extractTokenFromValue = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  if (trimmedValue.toLowerCase().startsWith("bearer ")) {
    const bearerToken = trimmedValue.slice(7).trim();
    return bearerToken || null;
  }

  return trimmedValue;
};

const extractSocketToken = (socket) => {
  return (
    extractTokenFromValue(socket.handshake?.auth?.token) ||
    extractTokenFromValue(socket.handshake?.headers?.authorization)
  );
};

const buildSafeSocketUser = (decodedUser = {}, dbUser = {}) => ({
  id: decodedUser?.id || null,
  unique_id: decodedUser?.unique_id || null,
  user_type: decodedUser?.user_type || null,
  tenant_id: decodedUser?.tenant_id || null,
  role: decodedUser?.role || null,
  email: dbUser?.email || null,
  name: buildDisplayName(dbUser) || dbUser?.email || null,
  username: dbUser?.username || null,
});

const authenticateSocketUser = async (socket) => {
  const token = extractSocketToken(socket);

  socket.user = null;
  socket.authError = null;
  socket.authAttempted = Boolean(token);

  if (!token) {
    return;
  }

  try {
    const decodedUser = jwt.verify(token, ServerEnvironmentConfig.jwt_key);

    if (decodedUser?.user_type === "management") {
      const managementUser = await getManagementByIdService(decodedUser.unique_id);

      if (
        !managementUser ||
        (managementUser?.status && managementUser.status !== "active")
      ) {
        socket.authError = "Access denied";
        return;
      }

      socket.user = buildSafeSocketUser(decodedUser, managementUser);
      return;
    }

    if (decodedUser?.user_type === "tenant") {
      const tenantUser = await findTenantUserByIdService(decodedUser.unique_id);

      if (!tenantUser || (tenantUser?.status && tenantUser.status !== "active")) {
        socket.authError = "Access denied";
        return;
      }

      socket.user = buildSafeSocketUser(decodedUser, tenantUser);
      return;
    }

    socket.authError = "Access denied";
  } catch {
    socket.authError = "Invalid or expired token";
  }
};

const isManagementSocketAllowed = (socketUser) => {
  return Boolean(
    socketUser?.user_type === "management" &&
      MANAGEMENT_SOCKET_ROLES.has(String(socketUser?.role || "").toLowerCase()),
  );
};

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  io.on("connection", (socket) => {
    const authenticationPromise = authenticateSocketUser(socket);

    socket.on("join-tenant", async (tenant_id) => {
      await authenticationPromise;

      if (socket.user?.user_type === "tenant") {
        if (String(socket.user?.tenant_id) !== String(tenant_id)) {
          socket.emit(TENANT_ROOM_JOIN_DENIED_EVENT, ACCESS_DENIED_PAYLOAD);
          return;
        }
      } else if (socket.user?.user_type === "management") {
        socket.emit(TENANT_ROOM_JOIN_DENIED_EVENT, ACCESS_DENIED_PAYLOAD);
        return;
      } else if (socket.authAttempted && socket.authError) {
        socket.emit(TENANT_ROOM_JOIN_DENIED_EVENT, ACCESS_DENIED_PAYLOAD);
        return;
      }

      // TODO: remove anonymous tenant-room join once all tenant realtime pages
      // use authenticated socket connections consistently.
      socket.join(`tenant-${tenant_id}`);
    });

    socket.on("join-management-room", async () => {
      await authenticationPromise;

      if (!isManagementSocketAllowed(socket.user)) {
        socket.emit(MANAGEMENT_ROOM_JOIN_DENIED_EVENT, ACCESS_DENIED_PAYLOAD);
        return;
      }

      socket.join(MANAGEMENT_ROOM);
      socket.emit(MANAGEMENT_ROOM_JOINED_EVENT, {
        room: MANAGEMENT_ROOM,
      });
    });

    socket.on("join-management-api-logs", async () => {
      await authenticationPromise;

      if (!isManagementSocketAllowed(socket.user)) {
        socket.emit("management-api-logs:join-denied", {
          message: socket.authError || "Access denied",
        });
        return;
      }

      socket.join(MANAGEMENT_API_LOGS_ROOM);
      socket.emit(MANAGEMENT_API_LOGS_JOINED_EVENT, {
        room: MANAGEMENT_API_LOGS_ROOM,
      });
    });

    socket.on("disconnect", () => {});
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
};
