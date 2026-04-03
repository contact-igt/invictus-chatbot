import express from "express";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";
import { paymentRateLimiter } from "../../middlewares/billing/billingRateLimiter.js";
import {
  createRazorpayOrderController,
  verifyRazorpayPaymentController,
  getPaymentHistoryController,
} from "./payment.controller.js";

const router = express.Router();

router.post(
  "/payment/order",
  authenticate,
  paymentRateLimiter,
  createRazorpayOrderController,
);
router.post(
  "/payment/verify",
  authenticate,
  paymentRateLimiter,
  verifyRazorpayPaymentController,
);
router.get("/payment/history", authenticate, getPaymentHistoryController);

export default router;
