import express from "express";
import {
  activateWhatsappAccountController,
  createWhatsappAccountController,
  getWhatsappAccountByIdController,
  testWhatsappAccountConnectionController,
  whatsappCallbackController,
} from "./whatsappAccount.controller.js";
import {
  authenticate,
  requireAdmin,
  requireManagement,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get("/callback", whatsappCallbackController);

Router.post(
  "/whatsapp-account",
  authenticate,
  requireAdmin,
  createWhatsappAccountController,
);

Router.get(
  "/whatsapp-accounts",
  authenticate,
  requireManagement,
  getWhatsappAccountByIdController,
);

Router.get(
  "/whatsapp-account/test-connect",
  authenticate,
  requireManagement,
  testWhatsappAccountConnectionController,
);

Router.put(
  "/whatsapp-account/status",
  authenticate,
  requireManagement,
  activateWhatsappAccountController,
);

export default Router;
