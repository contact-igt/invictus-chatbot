import express from "express";
import {
  processConversationController,
  findConversationByPhoneController,
} from "./conversation.controller.js";

const router = express.Router();

// test & main logic
router.post("/process", processConversationController);

// optional (debug)
router.post("/find", findConversationByPhoneController);

export default router;
