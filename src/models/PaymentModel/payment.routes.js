import express from "express";
import { authenticate } from "../../middlewares/auth/authMiddlewares.js";
import {
  paymentRateLimiter,
  invoicePaymentRateLimiter,
} from "../../middlewares/billing/billingRateLimiter.js";

import {
  createRazorpayOrderController,
  verifyRazorpayPaymentController,
  getPaymentHistoryController,
  razorpayWebhookController,
  getSavedPaymentMethod,
  removeSavedPaymentMethod,
} from "./payment.controller.js";
import { billingQueryRateLimiter } from "../../middlewares/billing/billingRateLimiter.js";

const router = express.Router();

router.get(
  "/payment/saved-method",
  authenticate,
  billingQueryRateLimiter,
  getSavedPaymentMethod,
);
router.delete(
  "/payment/saved-method",
  authenticate,
  billingQueryRateLimiter,
  removeSavedPaymentMethod,
);

router.post(
  "/payment/razorpay-webhook",
  express.raw({ type: "application/json" }),
  (req, _res, next) => {
    // Attach raw body string so controller can verify the signature
    req.rawBody = req.body?.toString("utf8") || "";
    next();
  },
  razorpayWebhookController,
);

// Authenticated payment endpoints
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
