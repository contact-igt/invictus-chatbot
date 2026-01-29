import express from "express";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { createWhatsappTemplateController } from "./whatsapptemplate.controller.js";

const router = express.Router();

router.post(
  "/template",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  createWhatsappTemplateController,
);

export default router;
