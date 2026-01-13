import express from "express";
import {
  getWhatsappAccountByIdController,
  whatsappCallbackController,
} from "./whatsappAccount.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get("/callback", authenticate, whatsappCallbackController);
Router.get("/whatsappaccount", authenticate, getWhatsappAccountByIdController);

export default Router;
