import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import {
  createWhatsappTemplateController,
  getTemplateByIdController,
  getTemplateListController,
  permanentDeleteTemplateController,
  softDeleteTemplateController,
  submitWhatsappTemplateController,
  syncAllWhatsappTemplatesController,
  syncWhatsappTemplateStatusController,
  updateWhatsappTemplateController,
  resubmitWhatsappTemplateController,
} from "./whatsapptemplate.controller.js";

const router = express.Router();

router.post(
  "/whatsapp-template",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
  createWhatsappTemplateController,
);

router.post(
  "/whatsapp-template/:template_id/submit",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "staff"],
  }),
  submitWhatsappTemplateController,
);

router.get(
  "/whatsapp-template/:template_id/sync",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "staff"],
  }),
  syncWhatsappTemplateStatusController,
);

router.post(
  "/whatsapp-templates/sync",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
  syncAllWhatsappTemplatesController,
);

router.get(
  "/whatsapp-templates",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
  getTemplateListController,
);

router.get(
  "/whatsapp-template/:template_id",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
  getTemplateByIdController,
);


router.put(
  "/whatsapp-template/:template_id",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
  updateWhatsappTemplateController,
);

router.post(
  "/whatsapp-template/:template_id/resubmit",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: ["tenant_admin", "staff"],
  }),
  resubmitWhatsappTemplateController,
);

router.delete(
  "/whatsapp-template/:template_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin", "staff"] }),
  softDeleteTemplateController,
);

router.delete(
  "/whatsapp-template/:template_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteTemplateController,
);

export default router;
