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
} from "./payment.controller.js";

const router = express.Router();

/**
 * Razorpay webhook — NO JWT auth, but uses HMAC signature verification.
 * Must use express.raw() so the raw body Buffer is available for signature check.
 */
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
