import express from "express";
import {
  getActivePromptController,
  getAiPromptById,
  listAiPrompt,
  updateAiPrompt,
  updatePromptActive,
  uploadAiPrompt,
  generateAiCompletionController,
} from "./aiprompt.controller.js";
import {
  softDeleteAiPromptController,
  hardDeleteAiPromptController,
  restoreAiPromptController,
  getDeletedAiPromptsController,
} from "./aiprompt.lifecycle.js";
import {
  authenticate,
  authorize,
} from "../../middlewares/auth/authMiddlewares.js";
import { requireAiAccess } from "../../middlewares/billing/billingAccessGuard.js";

const router = express.Router();

// Generic AI completion endpoint for frontend use
router.post(
  "/ai/completion",
  authenticate,
  requireAiAccess,
  generateAiCompletionController,
);

router.post("/prompt", authenticate, uploadAiPrompt);
router.get(
  "/prompts/deleted/list",
  authenticate,
  getDeletedAiPromptsController,
);
router.get("/prompts", authenticate, listAiPrompt);
router.get("/prompt/:id", authenticate, getAiPromptById);
router.get(
  "/prompt-active-lists",
  authenticate,

  getActivePromptController,
);
router.put("/prompt/:id", authenticate, updateAiPrompt);
router.put(
  "/prompt-active/:id",
  authenticate,

  updatePromptActive,
);
router.post(
  "/prompt/:id/restore",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  restoreAiPromptController,
);
router.delete("/prompt/:id/soft", authenticate, softDeleteAiPromptController);
router.delete(
  "/prompt/:id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  hardDeleteAiPromptController,
);

export default router;
