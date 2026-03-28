import express from "express";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";
import {
  createRazorpayOrderController,
  verifyRazorpayPaymentController,
  getPaymentHistoryController,
} from "./payment.controller.js";

const router = express.Router();

router.post("/payment/order", authenticate, createRazorpayOrderController);
router.post("/payment/verify", authenticate, verifyRazorpayPaymentController);
router.get("/payment/history", authenticate, getPaymentHistoryController);

export default router;
