import express from "express";
import {
  createLiveChatController,
  getLiveChatListController,
} from "./livechat.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.post("/live-chat", authenticate, createLiveChatController);
Router.get("/live-chats", authenticate, getLiveChatListController);

export default Router;
