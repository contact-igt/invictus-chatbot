import express from "express";
import {
  deleteAiPrompt,
  permanentDeleteAiPrompt,
  getActivePromptController,
  getAiPromptById,
  listAiPrompt,
  updateAiPrompt,
  updatePromptActive,
  uploadAiPrompt,
} from "./aiprompt.controller.js";
import { authenticate, authorize } from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

router.post("/prompt", authenticate, uploadAiPrompt);
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
router.delete("/prompt/:id", authenticate, deleteAiPrompt);
router.delete(
  "/prompt/:id/permanent",
  authenticate,
  authorize({ user_type: "tenant", roles: ["tenant_admin"] }),
  permanentDeleteAiPrompt,
);

export default router;
