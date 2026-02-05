import express from "express";
import {
  manualConnectWhatsappController,
  whatsappOAuthCallbackController,
  testWhatsappAccountController,
  activateWhatsappAccountController,
  getWhatsappAccountController,
  softDeleteWhatsappAccountController,
  permanentDeleteWhatsappAccountController,
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

router.get(
  "/whatsapp-account",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "doctor", "staff", "agent"],
  }),
  getWhatsappAccountController,
);

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

router.delete(
  "/whatsapp-account",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  softDeleteWhatsappAccountController,
);

router.delete(
  "/whatsapp-account/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteWhatsappAccountController,
);

export default router;
