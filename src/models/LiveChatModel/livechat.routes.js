import express from "express";
import {
  createLiveChatController,
  getLiveChatListController,
  getHistoryChatListController,
} from "./livechat.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

Router.post(
  "/live-chat",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createLiveChatController,
);
Router.get(
  "/live-chats",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getLiveChatListController,
);
Router.get(
  "/history-chats",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getHistoryChatListController,
);

export default Router;


