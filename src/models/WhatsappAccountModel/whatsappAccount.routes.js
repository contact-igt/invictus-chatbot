import express from "express";
import {
  activateWhatsappAccountController,
  getWhatsappAccountByIdController,
  manualWhatsappAccaountByIdController,
  testWhatsappConnectionController,
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
  manualWhatsappAccaountByIdController
);

Router.put("/whatsapp-account/status", activateWhatsappAccountController);

Router.get(
  "/whatsapp-accounts",
  authenticate,
  getWhatsappAccountByIdController
);

Router.get("/whatsapp-accout/test-connect" , testWhatsappConnectionController)

export default Router;
