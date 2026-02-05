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
  generateAiTemplateController,
} from "./whatsapptemplate.controller.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

router.post(
  "/whatsapp-template",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createWhatsappTemplateController,
);

router.post(
  "/whatsapp-template/:template_id/submit",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: tenantRoles,
  }),
  submitWhatsappTemplateController,
);

router.get(
  "/whatsapp-template/:template_id/sync",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: tenantRoles,
  }),
  syncWhatsappTemplateStatusController,
);

router.post(
  "/whatsapp-templates/sync",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  syncAllWhatsappTemplatesController,
);

router.get(
  "/whatsapp-templates",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getTemplateListController,
);

router.get(
  "/whatsapp-template/:template_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getTemplateByIdController,
);


router.put(
  "/whatsapp-template/:template_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateWhatsappTemplateController,
);

router.post(
  "/whatsapp-template/:template_id/resubmit",
  authenticate,
  authorize({
    user_type: "tenant",
    roles: tenantRoles,
  }),
  resubmitWhatsappTemplateController,
);

router.post(
  "/whatsapp-template/generate-ai",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  generateAiTemplateController,
);

router.delete(
  "/whatsapp-template/:template_id/soft",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  softDeleteTemplateController,
);

router.delete(
  "/whatsapp-template/:template_id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteTemplateController,
);

export default router;
