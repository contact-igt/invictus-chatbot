import express from "express";
import {
  deleteAiPrompt,
  getAiPromptById,
  listAiPrompt,
  updateAiPrompt,
  updatePromptActive,
  uploadAiPrompt,
} from "./aiprompt.controller.js";

const router = express.Router();

router.post("/prompt", uploadAiPrompt);
router.get("/prompts", listAiPrompt);
router.get("/prompt/:id", getAiPromptById);
router.put("/prompt/:id", updateAiPrompt);
router.put("/prompt-active/:id", updatePromptActive);
router.delete("/prompt/:id", deleteAiPrompt);

export default router;
