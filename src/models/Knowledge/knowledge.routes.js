import express from "express";
import {
  deleteKnowledge,
  getKnowledgeById,
  listKnowledge,
  searchKnowledgeChunksController,
  updateKnowledge,
  updateKnowledgeStatusController,
  uploadKnowledge,
} from "./knowledge.controller.js";
import {
  authenticate,
} from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

router.post("/knowledge", authenticate, uploadKnowledge);
router.get("/knowledges", authenticate, listKnowledge);
router.get("/knowledge/:id", authenticate, getKnowledgeById);
router.put("/knowledge/:id", authenticate, updateKnowledge);
router.delete("/knowledge/:id", authenticate, deleteKnowledge);
router.put(
  "/knowledge-status/:id",
  authenticate,

  updateKnowledgeStatusController,
);
router.post(
  "/knowledge-search",
  authenticate,

  searchKnowledgeChunksController,
);

export default router;
