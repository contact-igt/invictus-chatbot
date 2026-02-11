import express from "express";
import {
    createAiAnalysisLogController,
    getAiAnalysisLogsController,
    getAiAnalysisLogByIdController,
    updateAiLogStatusController,
    softDeleteAiAnalysisLogController,
    getDeletedAiAnalysisLogListController,
    restoreAiAnalysisLogController,
    permanentDeleteAiAnalysisLogController,
} from "./aiAnalysisLog.controller.js";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js"; // Adjust path as needed

const router = express.Router();

// Create log
router.post("/ai/logs", authenticate, createAiAnalysisLogController);

// Get deleted logs (Trash)
router.get("/ai/logs/deleted/list", authenticate, getDeletedAiAnalysisLogListController);

// Get logs (protected by auth)
router.get("/ai/logs", authenticate, getAiAnalysisLogsController);

// Get single log
router.get("/ai/logs/:id", authenticate, getAiAnalysisLogByIdController);

// Update status
router.patch("/ai/logs/:id/status", authenticate, updateAiLogStatusController);

// Restore log
router.put("/ai/logs/:id/restore", authenticate, restoreAiAnalysisLogController);

// Delete log (soft)
router.delete("/ai/logs/:id/soft", authenticate, softDeleteAiAnalysisLogController);

// Delete log (permanent)
router.delete("/ai/logs/:id/permanent", authenticate, permanentDeleteAiAnalysisLogController);

export default router;
