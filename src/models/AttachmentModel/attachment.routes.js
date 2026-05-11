import express from "express";
import { proxyMediaController } from "./attachment.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

// <img>, <video>, <audio> tags are native browser elements — they cannot set custom
// HTTP headers. When the frontend detects a meta_media_id URL it appends ?token=<jwt>
// so the browser fetch carries auth. This middleware moves it to the Authorization
// header before the standard authenticate middleware runs, identical in concept to
// AWS/R2 presigned URLs. Only applied when no Bearer header is already present.
const tokenFromQuery = (req, res, next) => {
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
};

Router.get(
  "/attachments/proxy",
  tokenFromQuery,
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  proxyMediaController,
);

export default Router;
