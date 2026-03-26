import express from "express";
import {
  manualConnectWhatsappController,
  whatsappOAuthCallbackController,
  testWhatsappAccountController,
  activateWhatsappAccountController,
  updateAccessTokenController,
  getWhatsappAccountController,
  softDeleteWhatsappAccountController,
  permanentDeleteWhatsappAccountController,
  subscribeToWebhooksController,
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

router.put(
  "/whatsapp-account/token",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  updateAccessTokenController,
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

// Subscribe app to Meta webhook fields (messages, message_template_status_update)
router.post(
  "/whatsapp-account/subscribe-webhooks",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  subscribeToWebhooksController,
);

export default router;
