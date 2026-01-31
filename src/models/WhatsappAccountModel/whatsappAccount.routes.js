import express from "express";
import {
  manualConnectWhatsappController,
  whatsappOAuthCallbackController,
  testWhatsappAccountController,
  activateWhatsappAccountController,
  getWhatsappAccountController,
} from "./whatsappAccount.controller.js";

import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

router.get("/whatsapp/oauth/callback", whatsappOAuthCallbackController);

router.post(
  "/whatsapp-account/manual",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  manualConnectWhatsappController,
);

router.get("/whatsapp-account", authenticate, getWhatsappAccountController);

router.post(
  "/whatsapp-account/test",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  testWhatsappAccountController,
);

router.post(
  "/whatsapp-account/activate",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  activateWhatsappAccountController,
);

export default router;
