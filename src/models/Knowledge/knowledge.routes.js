import express from "express";
import {
  deleteKnowledge,
  getKnowledgeById,
  listKnowledge,
  updateKnowledge,
  uploadKnowledge,
} from "./knowledge.controller.js";

const router = express.Router();

router.post("/knowledge", uploadKnowledge);
router.get("/knowledges", listKnowledge);
router.get("/knowledge/:id", getKnowledgeById);
router.put("/knowledge/:id", updateKnowledge);
router.delete("/knowledge/:id", deleteKnowledge);

export default router;
