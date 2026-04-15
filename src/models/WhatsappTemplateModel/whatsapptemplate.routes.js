import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { requireAiAccess } from "../../middlewares/billing/billingAccessGuard.js";
import {
  createWhatsappTemplateController,
  getTemplateByIdController,
  getTemplateListController,
  submitWhatsappTemplateController,
  syncAllWhatsappTemplatesController,
  syncWhatsappTemplateStatusController,
  updateWhatsappTemplateController,
  resubmitWhatsappTemplateController,
  generateAiTemplateController,
  uploadTemplateMediaController,
} from "./whatsapptemplate.controller.js";
import {
  softDeleteTemplateController,
  hardDeleteTemplateController,
  restoreTemplateController,
  getDeletedTemplatesController,
} from "./whatsapptemplate.lifecycle.js";

const router = express.Router();

const tenantRoles = ["tenant_admin", "doctor", "staff", "agent"];

router.post(
  "/whatsapp-template",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createWhatsappTemplateController,
);

router.get(
  "/whatsapp-templates/deleted/list",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getDeletedTemplatesController,
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
  requireAiAccess,
  generateAiTemplateController,
);

router.post(
  "/whatsapp-template/upload-media",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  uploadTemplateMediaController,
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
  hardDeleteTemplateController,
);

router.post(
  "/whatsapp-template/:template_id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreTemplateController,
);

// REST aliases (v1 contract friendly)
router.post(
  "/templates",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  createWhatsappTemplateController,
);
router.get(
  "/templates",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getTemplateListController,
);
router.get(
  "/templates/:template_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  getTemplateByIdController,
);
router.put(
  "/templates/:template_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  updateWhatsappTemplateController,
);
router.delete(
  "/templates/:template_id",
  authenticate,
  authorize({ user_type: "tenant", roles: tenantRoles }),
  softDeleteTemplateController,
);

export default router;
