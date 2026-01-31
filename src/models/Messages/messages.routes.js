import express from "express";
import {
  getChatByPhone,
  getChatList,
  markSeenMessage,
  sendAdminMessage,
  sendTemplateMessageController,
  suggestReplyController,
} from "./messages.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get("/chats", authenticate, getChatList);
Router.get("/chats/:phone", authenticate, getChatByPhone);
Router.post("/chats/send", authenticate, sendAdminMessage);
Router.post("/chats/send-template", authenticate, sendTemplateMessageController);
Router.put("/chats/mark", authenticate, markSeenMessage);
Router.post("/chats/suggest", authenticate, suggestReplyController);

export default Router;
