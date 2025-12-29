import express from "express";
import {
  getChatByPhone,
  getChatList,
  markSeenMessage,
  sendAdminMessage,
} from "./messages.controller.js";

const Router = express.Router();

Router.get("/chats", getChatList);
Router.get("/chats/:phone", getChatByPhone);
Router.post("/chats/send", sendAdminMessage);
Router.put("/chats/mark", markSeenMessage);

export default Router;
