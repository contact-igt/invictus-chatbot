import express from "express";
import {
  deleteAiPrompt,
  getActivePromptController,
  getAiPromptById,
  listAiPrompt,
  updateAiPrompt,
  updatePromptActive,
  uploadAiPrompt,
} from "./aiprompt.controller.js";
import {
  authenticate,
  requireManagement,
} from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

router.post("/prompt", authenticate, requireManagement, uploadAiPrompt);
router.get("/prompts", authenticate, requireManagement, listAiPrompt);
router.get("/prompt/:id", authenticate, requireManagement, getAiPromptById);
router.get(
  "/prompt-active-lists",
  authenticate,
  requireManagement,
  getActivePromptController,
);
router.put("/prompt/:id", authenticate, requireManagement, updateAiPrompt);
router.put(
  "/prompt-active/:id",
  authenticate,
  requireManagement,
  updatePromptActive,
);
router.delete("/prompt/:id", authenticate, requireManagement, deleteAiPrompt);

export default router;
