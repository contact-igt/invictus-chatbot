import express from "express";
import {
  activateWhatsappAccountController,
  createWhatsappAccountController,
  getWhatsappAccountByIdController,
  testWhatsappAccountConnectionController,
  whatsappCallbackController,
} from "./whatsappAccount.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get("/callback", whatsappCallbackController);

Router.post("/whatsapp-account", authenticate, createWhatsappAccountController);

Router.get(
  "/whatsapp-accounts",
  authenticate,
  getWhatsappAccountByIdController
);

Router.get(
  "/whatsapp-account/test-connect",
  authenticate,
  testWhatsappAccountConnectionController
);

Router.put(
  "/whatsapp-account/status",
  authenticate,
  activateWhatsappAccountController
);

export default Router;
