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
  requireManagement,
} from "../../middlewares/auth/authMiddlewares.js";

const router = express.Router();

router.post("/knowledge", authenticate, requireManagement, uploadKnowledge);
router.get("/knowledges", authenticate, requireManagement, listKnowledge);
router.get("/knowledge/:id", authenticate, requireManagement, getKnowledgeById);
router.put("/knowledge/:id", authenticate, requireManagement, updateKnowledge);
router.delete(
  "/knowledge/:id",
  authenticate,
  requireManagement,
  deleteKnowledge,
);
router.put(
  "/knowledge-status/:id",
  authenticate,
  requireManagement,
  updateKnowledgeStatusController,
);
router.post(
  "/knowledge-search",
  authenticate,
  requireManagement,
  searchKnowledgeChunksController,
);

export default router;
