import express from "express";
import {
  activateWhatsappAccountController,
  getWhatsappAccountByIdController,
  manualWhatsappAccaountByIdController,
  whatsappCallbackController,
} from "./whatsappAccount.controller.js";
import {
  authenticate,
  requireAdmin,
  requireManagement,
} from "../../middlewares/auth/authMiddlewares.js";

const Router = express.Router();

Router.get("/callback", whatsappCallbackController);
Router.get(
  "/whatsapp-accounts",
  authenticate,
  getWhatsappAccountByIdController
);
Router.post(
  "/whatsapp-account",
  authenticate,
  manualWhatsappAccaountByIdController
);

Router.put("/whatsapp-account/status" , activateWhatsappAccountController)

export default Router;
