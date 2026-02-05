import express from "express";
import {
  getChatByPhone,
  getChatList,
  markSeenMessage,
  sendAdminMessage,
  sendTemplateMessageController,
  suggestReplyController,
} from "./messages.controller.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

Router.get(
  "/chats",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getChatList,
);
Router.get(
  "/chats/:phone",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getChatByPhone,
);
Router.post(
  "/chats/send",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  sendAdminMessage,
);
Router.post(
  "/chats/send-template",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  sendTemplateMessageController,
);
Router.put(
  "/chats/mark",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  markSeenMessage,
);
Router.post(
  "/chats/suggest",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  suggestReplyController,
);

export default Router;
